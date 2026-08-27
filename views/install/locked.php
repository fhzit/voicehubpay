<?php /** @var array $state @var \VoiceHubPay\App $__app */ ?>
<div class="install-card" style="text-align:center;max-width:520px;margin:0 auto;">
  <div class="status-ico info" style="width:56px;height:56px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>
  <h2>安装已完成</h2>
  <p class="ic-sub" style="margin-bottom:6px;">系统已完成安装，安装向导已锁定。</p>
  <p class="small muted">如确认需要重装，请先备份数据后删除 <code class="inline">storage/install.lock</code> 与 settings.sqlite 中的配置。</p>
  <div class="flex" style="justify-content:center;gap:12px;margin-top:20px;">
    <a href="/admin" class="btn btn-primary">进入管理后台</a>
    <a href="/" class="btn btn-outline">访问商城首页</a>
  </div>
</div>
