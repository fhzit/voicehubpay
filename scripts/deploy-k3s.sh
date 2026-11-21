#!/usr/bin/env bash
# Deploy VoiceHubPay (TS) to k3s (Rancher cluster asia-k3s, namespace idoknow).
#
# Same shape as campux/scripts/deploy-k3s.sh: pin an image digest, patch the
# Deployment, wait for the rollout, then assert the cluster really runs it.
#
# Required env:
#   KUBECONFIG_DATA  namespace-scoped kubeconfig (repo secret VOICEHUBPAY_KUBECONFIG)
#   GITHUB_SHA       commit being released
#   IMAGE_DIGEST     sha256:... produced by the build job
# Optional env:
#   PULL_REGISTRY    default ghcr.nju.edu.cn (CN nodes cannot reach ghcr.io)
#   HEALTH_URL       default https://vhpay.idoknow.top/health (best effort)
set -euo pipefail
: "${KUBECONFIG_DATA:?}" "${GITHUB_SHA:?}" "${IMAGE_DIGEST:?}"
PULL_REGISTRY="${PULL_REGISTRY:-ghcr.nju.edu.cn}"
HEALTH_URL="${HEALTH_URL:-https://vhpay.idoknow.top/health}"
DEPLOYMENT=voicehubpay-ts

umask 077
export KUBECONFIG="$(mktemp)"
trap 'rm -f "$KUBECONFIG"' EXIT

kubectl_retry() {
  local attempt=1 max_attempts=5 delay=2
  while true; do
    if kubectl --request-timeout=60s "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      printf 'kubectl command failed after %s attempts: %s\n' "$max_attempts" "$*" >&2
      return 1
    fi
    printf 'kubectl command failed (attempt %s/%s); retrying in %ss: %s\n' "$attempt" "$max_attempts" "$delay" "$*" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

printf '%s' "$KUBECONFIG_DATA" > "$KUBECONFIG"

IMAGE="${PULL_REGISTRY}/fhzit/voicehubpay@${IMAGE_DIGEST}"
[[ "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { printf 'refusing non-digest image: %s\n' "$IMAGE" >&2; exit 1; }
printf 'deploying %s (source %s)\n' "$IMAGE" "$GITHUB_SHA"

# Keep the old pod serving during the rollout.
kubectl_retry -n idoknow patch deployment "$DEPLOYMENT" --type merge \
  -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}' >/dev/null

# One Deployment, two containers (server + worker) sharing the image.
payload="$(jq -nc \
  --arg sha "$GITHUB_SHA" \
  --arg image "$IMAGE" \
  '{metadata:{annotations:{"voicehubpay/source-sha":$sha}},
    spec:{template:{metadata:{annotations:{"voicehubpay/source-sha":$sha}},
      spec:{containers:[
        {name:"server",image:$image},
        {name:"worker",image:$image}
      ]}}}}')"
kubectl_retry -n idoknow patch deployment "$DEPLOYMENT" --type strategic -p "$payload"

kubectl_retry -n idoknow rollout status "deployment/$DEPLOYMENT" --timeout=600s

# Prove reality, do not trust the patch response.
kubectl_retry -n idoknow get deployment "$DEPLOYMENT" -o json | jq -e \
  --arg image "$IMAGE" --arg sha "$GITHUB_SHA" \
  '(.spec.template.spec.containers | map(select(.name == "server" or .name == "worker")) | length == 2)
   and ([.spec.template.spec.containers[] | select(.name == "server" or .name == "worker") | .image == $image] | all)
   and .metadata.annotations["voicehubpay/source-sha"] == $sha
   and .status.observedGeneration == .metadata.generation
   and .status.updatedReplicas == .spec.replicas
   and .status.availableReplicas == .spec.replicas'

# Best effort: the China ingress is not always reachable from CI runners, so a
# curl failure is reported but does not fail the release. Rollout + image +
# availableReplicas above already prove the new image is serving in-cluster.
if curl -fsS --retry 5 --retry-delay 5 --retry-all-errors --max-time 20 "$HEALTH_URL" >/dev/null; then
  printf 'health check OK: %s\n' "$HEALTH_URL"
else
  printf 'warning: health check unreachable from CI (%s); in-cluster rollout is verified\n' "$HEALTH_URL" >&2
fi
