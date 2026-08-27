<?php /** @var string $request_id @var \VoiceHubPay\App $__app @var array $__site */ ?>
<div class="container">
  <div class="pay-confirm text-center" style="max-width:520px;">
    <div class="status-ico warning">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
    </div>
    <h1>500</h1>
    <p class="pc-sub">服务器发生了一个意外错误，请稍后重试。</p>
    <?php if (!empty($request_id)): ?>
      <div class="card" style="text-align:left;padding:14px 18px;margin-bottom:20px;">
        <div class="small muted">请求编号</div>
        <div class="mono" style="font-size:13px;"><?= \VoiceHubPay\Http\View::e($request_id) ?></div>
      </div>
    <?php endif; ?>
    <a href="/" class="btn btn-primary">返回首页</a>
  </div>
</div>
