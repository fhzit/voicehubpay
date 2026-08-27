/* ============================================================================
   VoiceHubPay — front-end behaviors (vanilla JS, no build step)
   Indigo Slate Design System
   ----------------------------------------------------------------------------
   - 主题：light / dark / system（localStorage 持久化，跟随系统，无 FOUC）
   - 自定义确认弹窗（替代 window.confirm，支持危险动作 data-confirm-danger）
   - Toast：右上白卡 + 左侧语义图标
   - 保留既有行为：移动导航 / 复制 / 数量步进 / 支付方式 / 卡密展示 / 轮询 / Modal
   ============================================================================ */
(function () {
  'use strict';

  var CSRF = function () {
    var el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  };

  function postForm(url, data, opts) {
    opts = opts || {};
    var body = new URLSearchParams(data || {});
    var csrf = CSRF();
    if (csrf) { body.set('_csrf', csrf); }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: body.toString()
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, data: j }; });
    });
  }

  /* ------------------------------------------------------------ icons */
  var ICONS = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    alert: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>'
  };

  /* ------------------------------------------------------------ toast */
  function toast(message, type) {
    type = type || 'success';
    var icon = type === 'error' || type === 'danger' ? ICONS.error : (type === 'warning' ? ICONS.warning : ICONS.success);
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var t = document.createElement('div');
    t.className = 'alert alert-' + type;
    t.innerHTML = '<span style="color:' + (type === 'error' || type === 'danger' ? 'var(--destructive)' : type === 'warning' ? 'var(--warning)' : 'var(--success)') + ';display:inline-flex;">' + icon + '</span><span style="padding-top:1px;">' + escapeHtml(message) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(-6px)'; setTimeout(function () { t.remove(); }, 320); }, 3800);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ------------------------------------------------------------ 自定义确认弹窗 */
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.display = 'flex';
      var danger = !!opts.danger;
      var tone = danger ? 'var(--destructive)' : 'var(--primary)';
      var soft = danger ? 'var(--destructive-soft)' : 'var(--primary-soft)';
      backdrop.innerHTML =
        '<div class="modal" role="alertdialog" aria-modal="true" aria-label="确认操作" style="max-width:420px;">' +
          '<div class="modal-body">' +
            '<div style="display:flex;gap:14px;">' +
              '<div style="width:38px;height:38px;flex:none;display:grid;place-items:center;border-radius:50%;background:' + soft + ';color:' + tone + ';">' +
                (danger ? ICONS.alert : ICONS.shield) +
              '</div>' +
              '<div style="min-width:0;">' +
                '<div style="font-size:15px;font-weight:650;margin-bottom:6px;">' + escapeHtml(opts.title || '确认操作') + '</div>' +
                '<div style="font-size:13px;color:var(--muted-foreground);line-height:1.65;">' + (opts.html || escapeHtml(opts.message || '')) + '</div>' +
                (danger ? '<div class="danger-note">该操作不可轻易撤销，请确认信息无误。</div>' : '') +
              '</div>' +
            '</div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-secondary" data-cm-cancel>取消</button>' +
              '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-cm-ok>' + escapeHtml(opts.okText || (danger ? '确认' : '确认')) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(backdrop);
      function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
      function onKey(e) { if (e.key === 'Escape') { close(); resolve(false); } }
      document.addEventListener('keydown', onKey);
      backdrop.querySelector('[data-cm-cancel]').addEventListener('click', function () { close(); resolve(false); });
      backdrop.querySelector('[data-cm-ok]').addEventListener('click', function () { close(); resolve(true); });
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) { close(); resolve(false); } });
      var okBtn = backdrop.querySelector('[data-cm-ok]');
      if (okBtn) { okBtn.focus(); }
    });
  }

  /* 表单 data-confirm：普通确认主色 / data-confirm-danger 危险红色 */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var msg = form.getAttribute('data-confirm');
    if (msg && !form.getAttribute('data-confirm-done')) {
      e.preventDefault();
      var danger = form.hasAttribute('data-confirm-danger') || /解绑|删除|取消|强制|标记完成|人工入账|确认完成/.test(msg);
      var title = form.getAttribute('data-confirm-title') || (danger ? '危险操作' : '确认操作');
      confirmModal({ title: title, message: msg, danger: danger }).then(function (ok) {
        if (ok) { form.setAttribute('data-confirm-done', '1'); form.submit(); }
      });
    }
  });

  /* ------------------------------------------------------------ 主题 */
  var THEMES = ['light', 'dark', 'system'];
  var storedTheme = null;
  try { storedTheme = localStorage.getItem('vhpay_theme'); } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var savedTheme = THEMES.indexOf(storedTheme) >= 0 ? storedTheme : 'system';

  function applyTheme(mode) {
    var dark = mode === 'dark' || (mode === 'system' && mq && mq.matches);
    document.documentElement.classList.toggle('dark', !!dark);
    try { localStorage.setItem('vhpay_theme', mode); } catch (e) {}
    savedTheme = mode;
    syncThemeMenu();
  }
  function syncThemeMenu() {
    document.querySelectorAll('[data-theme-option]').forEach(function (b) {
      var on = b.getAttribute('data-theme-option') === savedTheme;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var toggle = document.querySelector('[data-theme-toggle]');
    if (toggle) {
      var dark = document.documentElement.classList.contains('dark');
      toggle.setAttribute('aria-label', dark ? '切换为浅色主题' : '切换为深色主题');
      var sun = toggle.querySelector('[data-ico-sun]'), moon = toggle.querySelector('[data-ico-moon]');
      if (sun) sun.style.display = dark ? 'none' : '';
      if (moon) moon.style.display = dark ? '' : 'none';
    }
  }
  if (mq) { mq.addEventListener('change', function () { if (savedTheme === 'system') { applyTheme('system'); } }); }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-theme-toggle]');
    if (toggle) {
      e.preventDefault();
      var menu = document.getElementById(toggle.getAttribute('data-theme-toggle') || 'theme-menu');
      if (menu) {
        var open = menu.classList.toggle('open');
        if (open) { menu.querySelector('button').focus(); }
      } else {
        // 无菜单时直接切换 light/dark
        applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
      }
      return;
    }
    var opt = e.target.closest('[data-theme-option]');
    if (opt) { applyTheme(opt.getAttribute('data-theme-option')); return; }
    var menu = document.getElementById('theme-menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !(e.target.closest('[data-theme-toggle]'))) {
      menu.classList.remove('open');
    }
  });

  /* ------------------------------------------------------------ modal（既有） */
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-modal-open]');
    if (opener) {
      var id = opener.getAttribute('data-modal-open');
      var modal = document.getElementById(id);
      if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        var first = modal.querySelector('input:not([type=hidden]), select, textarea, button');
        if (first) { setTimeout(function () { first.focus(); }, 30); }
      }
      e.preventDefault();
      return;
    }
    var closer = e.target.closest('[data-modal-close]');
    if (closer) {
      var m = closer.closest('.modal-backdrop');
      if (m) { m.classList.remove('show'); document.body.style.overflow = ''; }
      return;
    }
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.classList.remove('show');
      document.body.style.overflow = '';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.show').forEach(function (m) { m.classList.remove('show'); });
      document.body.style.overflow = '';
    }
  });

  /* ------------------------------------------------------------ drawer */
  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-drawer-open]');
    if (opener) {
      var id = opener.getAttribute('data-drawer-open');
      var drawer = document.getElementById(id);
      var bd = document.getElementById(id + '-backdrop');
      if (drawer) { drawer.classList.add('show'); }
      if (bd) { bd.classList.add('show'); }
      document.body.style.overflow = 'hidden';
      e.preventDefault();
      return;
    }
    var closer = e.target.closest('[data-drawer-close]');
    if (closer) { closeDrawer(closer.closest('.drawer')); return; }
  });
  function closeDrawer(drawer) {
    if (!drawer) { return; }
    drawer.classList.remove('show');
    var bd = document.getElementById(drawer.id + '-backdrop');
    if (bd) { bd.classList.remove('show'); }
    document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------ 移动导航 */
  var burger = document.querySelector('.nav-burger');
  if (burger) {
    burger.addEventListener('click', function () {
      var links = document.querySelector('.shop-nav-links');
      if (links) { links.classList.toggle('open'); }
    });
  }
  var sideToggle = document.querySelector('.admin-mobile-toggle');
  var backdrop = document.querySelector('.sidebar-backdrop');
  if (sideToggle) {
    sideToggle.addEventListener('click', function () {
      var sb = document.querySelector('.admin-sidebar');
      if (sb) { sb.classList.add('open'); }
      if (backdrop) { backdrop.classList.add('show'); }
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', function () {
      var sb = document.querySelector('.admin-sidebar');
      if (sb) { sb.classList.remove('open'); }
      backdrop.classList.remove('show');
    });
  }

  /* ------------------------------------------------------------ copy */
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(true); } catch (err) { done(false); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else { fallback(); }
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) { return; }
    var text = btn.getAttribute('data-copy');
    if (text === '__target') {
      var target = document.querySelector(btn.getAttribute('data-copy-target'));
      text = target ? target.textContent.trim() : '';
    }
    if (!text) { return; }
    copyText(text, function (ok) { toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'success' : 'error'); });
  });

  /* ------------------------------------------------------------ 数量步进器 */
  document.querySelectorAll('[data-stepper]').forEach(function (root) {
    var input = root.querySelector('input[type=number]');
    if (!input) { return; }
    var min = parseInt(input.min || '1', 10);
    var max = parseInt(input.max || '99', 10);
    var step = parseInt(input.step || '1', 10);
    function updateTotal() {
      var priceCents = parseInt(root.getAttribute('data-price-cents') || '0', 10);
      var qty = parseInt(input.value || '0', 10) || 0;
      var cents = priceCents * qty;
      var text = '¥' + (cents / 100).toFixed(2);
      document.querySelectorAll('[data-total-cents]').forEach(function (total) { total.textContent = text; });
    }
    root.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var delta = parseInt(btn.getAttribute('data-step'), 10);
        var next = (parseInt(input.value || min, 10) || min) + delta * step;
        if (next < min) { next = min; }
        if (next > max) { next = max; }
        input.value = next;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        updateTotal();
      });
    });
    input.addEventListener('change', function () {
      var v = parseInt(input.value, 10);
      if (isNaN(v) || v < min) { input.value = min; }
      else if (v > max) { input.value = max; }
      updateTotal();
    });
    updateTotal();
  });

  /* ------------------------------------------------------------ 支付方式选择 */
  function selectPayMethod(el) {
    document.querySelectorAll('.pay-method').forEach(function (o) { o.classList.remove('active'); o.setAttribute('aria-checked', 'false'); });
    el.classList.add('active');
    el.setAttribute('aria-checked', 'true');
    var hidden = document.getElementById('pay_type');
    if (hidden) { hidden.value = el.getAttribute('data-type'); }
  }
  document.querySelectorAll('.pay-method').forEach(function (el) {
    el.addEventListener('click', function () { selectPayMethod(el); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPayMethod(el); }
    });
  });

  /* ------------------------------------------------------------ 卡密展示 */
  function revealError(btn, fallbackLabel) {
    btn.disabled = false;
    btn.textContent = fallbackLabel || '查看';
  }
  document.querySelectorAll('[data-reveal-unit]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-reveal-unit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>';
      postForm('/api/cards/' + id + '/reveal', {}).then(function (res) {
        if (res.ok && res.data.ok) {
          var box = document.getElementById('code-box-' + id);
          if (box) { box.textContent = res.data.code; }
          var mask = document.getElementById('mask-' + id);
          if (mask) { mask.style.display = 'none'; }
          btn.remove();
          toast('已展示卡密');
        } else {
          revealError(btn, '查看卡密');
          toast((res.data && res.data.error) || '获取失败', 'error');
        }
      }).catch(function () {
        revealError(btn, '查看卡密');
        toast('网络错误', 'error');
      });
    });
  });

  document.querySelectorAll('[data-reveal-order]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var orderNo = btn.getAttribute('data-reveal-order');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>';
      postForm('/api/orders/' + encodeURIComponent(orderNo) + '/reveal-all', {}).then(function (res) {
        if (res.ok && res.data.ok) {
          document.querySelectorAll('[data-unit-code]').forEach(function (el) { el.style.display = 'none'; });
          document.querySelectorAll('[data-code-target]').forEach(function (el) { el.textContent = res.data.codes.join('\n'); });
          btn.remove();
          toast('已展示全部卡密');
        } else {
          revealError(btn, '全部展示');
          toast((res.data && res.data.error) || '获取失败', 'error');
        }
      }).catch(function () {
        revealError(btn, '全部展示');
        toast('网络错误', 'error');
      });
    });
  });

  /* ------------------------------------------------------------ 支付轮询 */
  var pollEl = document.querySelector('[data-poll]');
  if (pollEl) {
    var url = pollEl.getAttribute('data-poll');
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok && (j.payment_status === 'paid' || j.order_status === 'completed')) {
            clearInterval(timer);
            window.location.reload();
          } else if (attempts >= 120) {
            clearInterval(timer);
            var hint = document.getElementById('poll-timeout');
            if (hint) { hint.style.display = 'block'; }
          }
        })
        .catch(function () {});
    }, 3000);
  }

  /* ------------------------------------------------------------ 后台单元状态辅助 */
  document.querySelectorAll('[data-target-select]').forEach(function (sel) {
    var hidden = document.getElementById(sel.getAttribute('data-target-select'));
    if (hidden) {
      sel.addEventListener('change', function () { hidden.value = sel.value; });
    }
  });

  /* ------------------------------------------------------------ 密码输入显示切换 */
  document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-pw-toggle'));
      if (target) {
        var show = target.type === 'password';
        target.type = show ? 'text' : 'password';
        btn.textContent = show ? '隐藏' : '显示';
      }
    });
  });

  /* ------------------------------------------------------------ flash 自动消失 */
  document.querySelectorAll('.flash-auto').forEach(function (el) {
    setTimeout(function () {
      el.style.transition = 'opacity .5s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 600);
    }, 3800);
  });

  /* ------------------------------------------------------------ 测试连接按钮通用 */
  document.querySelectorAll('[data-action-test]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-action-test');
      var target = document.querySelector(btn.getAttribute('data-result') || '[data-test-result]');
      btn.disabled = true;
      var old = btn.textContent;
      btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 测试中…';
      var body = new URLSearchParams();
      var csrf = CSRF();
      if (csrf) { body.set('_csrf', csrf); }
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: body.toString() })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (target) {
            target.innerHTML = '<div class="notice notice-' + (j.ok ? 'green' : 'red') + '" style="margin-top:10px;">' + escapeHtml(j.message || (j.ok ? '连接正常' : '连接失败')) + '</div>';
          } else {
            toast(j.message || (j.ok ? '连接正常' : '连接失败'), j.ok ? 'success' : 'error');
          }
        })
        .catch(function () { toast('测试失败', 'error'); })
        .finally(function () { btn.disabled = false; btn.textContent = old; });
    });
  });

  applyTheme(savedTheme);

  window.VHP = { postForm: postForm, toast: toast, csrf: CSRF, confirm: confirmModal, theme: applyTheme };
})();
