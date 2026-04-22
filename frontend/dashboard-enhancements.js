/**
 * Retlify Dashboard Enhancements
 * ------------------------------
 * 1) Auto-fetch full user profile from /api/auth/me on page load
 *    and merge into localStorage, then broadcast a `user-refreshed` event
 *    so any existing init code can re-render with fresh data.
 * 2) Close the notification panel when clicking anywhere outside it.
 * 3) Inject a floating yellow AI chat button (bottom-right) that opens
 *    a small chat window talking to /api/ai/chat.
 *
 * Safe to load on every page - each feature checks its own prerequisites.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------ */
  /* 1. Auto-fetch full user profile                              */
  /* ------------------------------------------------------------ */
  async function refreshProfile() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) {
        if (res.status === 401) {
          // Token invalid/expired - send user back to login
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          if (location.pathname.includes('dashboard') || location.pathname.includes('survey')) {
            location.href = '/login.html';
          }
        }
        return;
      }
      const data = await res.json();
      if (data && data.user) {
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.user.language) localStorage.setItem('retlify_lang', data.user.language);
        // Broadcast so dashboard UI can re-render
        document.dispatchEvent(new CustomEvent('user-refreshed', { detail: data.user }));
        // Auto-fill common profile fields if they exist on the page
        hydrateProfileFields(data.user);
      }
    } catch (err) {
      console.warn('[enhancements] profile refresh failed:', err.message);
    }
  }

  function hydrateProfileFields(user) {
    if (!user) return;
    // Fill any element with data-user-field="fieldName" or common IDs
    const map = {
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      profileViews: user.profileViews || 0,
      productCount: user.productCount || 0,
      queryCount: user.queryCount || 0,
    };
    Object.keys(map).forEach(function (key) {
      document.querySelectorAll('[data-user-field="' + key + '"]').forEach(function (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = map[key];
        else el.textContent = map[key];
      });
    });
    // Greeting element if present
    const greet = document.getElementById('userGreet') || document.querySelector('.user-greet');
    if (greet && user.name) greet.textContent = user.name;
    // Avatar initial
    const avatar = document.querySelector('.user-avatar, #userAvatar');
    if (avatar && user.name) avatar.textContent = user.name.charAt(0).toUpperCase();
  }

  /* ------------------------------------------------------------ */
  /* 2. Close notification panel on outside-click                 */
  /* ------------------------------------------------------------ */
  function wireNotificationOutsideClose() {
    document.addEventListener('click', function (e) {
      const panel = document.getElementById('notifPanel');
      const btn   = document.getElementById('notifBtn');
      if (!panel || !panel.classList.contains('open')) return;
      // If click is inside the bell button or the panel itself, leave it open
      if ((btn && btn.contains(e.target)) || panel.contains(e.target)) return;
      panel.classList.remove('open');
    }, true);

    // Also close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const panel = document.getElementById('notifPanel');
      if (panel) panel.classList.remove('open');
    });
  }

  /* ------------------------------------------------------------ */
  /* 3. Floating AI chat widget (yellow button, bottom-right)     */
  /* ------------------------------------------------------------ */
  function injectChatWidget() {
    // Don't inject twice
    if (document.getElementById('retlify-ai-fab')) return;

    const css = document.createElement('style');
    css.textContent = [
      '#retlify-ai-fab{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;',
      'background:linear-gradient(135deg,#FFD23F 0%,#FFB800 100%);color:#1a1d23;border:none;cursor:pointer;',
      'box-shadow:0 8px 24px rgba(255,184,0,0.45),0 2px 6px rgba(0,0,0,0.15);z-index:99998;',
      'display:flex;align-items:center;justify-content:center;font-size:26px;transition:transform .2s ease;',
      'font-family:inherit;}',
      '#retlify-ai-fab:hover{transform:scale(1.08);}',
      '#retlify-ai-fab:active{transform:scale(0.95);}',
      '#retlify-ai-panel{position:fixed;bottom:100px;right:24px;width:360px;max-width:calc(100vw - 32px);',
      'height:520px;max-height:calc(100vh - 140px);background:#ffffff;color:#1a1d23;border-radius:18px;',
      'box-shadow:0 20px 60px rgba(0,0,0,0.25),0 4px 12px rgba(0,0,0,0.1);z-index:99999;display:none;',
      'flex-direction:column;overflow:hidden;font-family:inherit;animation:retlifyAiPop .22s ease-out;}',
      '@keyframes retlifyAiPop{from{opacity:0;transform:translateY(12px) scale(0.96);}to{opacity:1;transform:translateY(0) scale(1);}}',
      '#retlify-ai-panel.open{display:flex;}',
      '#retlify-ai-head{background:linear-gradient(135deg,#1a1d23 0%,#2d3139 100%);color:#FFD23F;padding:14px 18px;',
      'font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:space-between;}',
      '#retlify-ai-head .title{display:flex;align-items:center;gap:8px;}',
      '#retlify-ai-close{background:transparent;border:none;color:#FFD23F;cursor:pointer;font-size:22px;line-height:1;padding:0 4px;}',
      '#retlify-ai-msgs{flex:1;overflow-y:auto;padding:16px;background:#F9FAFB;display:flex;flex-direction:column;gap:10px;}',
      '.rt-msg{max-width:85%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;word-wrap:break-word;}',
      '.rt-msg.user{align-self:flex-end;background:#1a1d23;color:#fff;border-bottom-right-radius:4px;}',
      '.rt-msg.bot{align-self:flex-start;background:#fff;color:#1a1d23;border:1px solid #E5E7EB;border-bottom-left-radius:4px;}',
      '.rt-msg.bot.loading{color:#6B7280;font-style:italic;}',
      '#retlify-ai-form{display:flex;gap:8px;padding:12px;border-top:1px solid #E5E7EB;background:#fff;}',
      '#retlify-ai-input{flex:1;padding:10px 14px;border:1px solid #E5E7EB;border-radius:22px;font-size:14px;outline:none;font-family:inherit;}',
      '#retlify-ai-input:focus{border-color:#FFD23F;box-shadow:0 0 0 3px rgba(255,210,63,0.2);}',
      '#retlify-ai-send{background:#FFD23F;color:#1a1d23;border:none;padding:0 18px;border-radius:22px;font-weight:700;cursor:pointer;font-size:14px;}',
      '#retlify-ai-send:disabled{opacity:0.5;cursor:not-allowed;}',
      '@media(max-width:480px){#retlify-ai-panel{width:calc(100vw - 24px);right:12px;bottom:90px;height:calc(100vh - 120px);}}'
    ].join('');
    document.head.appendChild(css);

    // Floating button
    const fab = document.createElement('button');
    fab.id = 'retlify-ai-fab';
    fab.setAttribute('aria-label', 'Open AI Assistant');
    fab.title = 'Ask Retlify AI';
    fab.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    document.body.appendChild(fab);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'retlify-ai-panel';
    panel.innerHTML = [
      '<div id="retlify-ai-head">',
      '  <span class="title"><span style="font-size:18px">*</span> Retlify AI</span>',
      '  <button id="retlify-ai-close" aria-label="Close">&times;</button>',
      '</div>',
      '<div id="retlify-ai-msgs"></div>',
      '<form id="retlify-ai-form">',
      '  <input id="retlify-ai-input" type="text" placeholder="Ask me anything..." autocomplete="off" maxlength="500" />',
      '  <button id="retlify-ai-send" type="submit">Send</button>',
      '</form>'
    ].join('');
    document.body.appendChild(panel);

    const msgsEl  = panel.querySelector('#retlify-ai-msgs');
    const form    = panel.querySelector('#retlify-ai-form');
    const input   = panel.querySelector('#retlify-ai-input');
    const sendBtn = panel.querySelector('#retlify-ai-send');
    const history = [];

    function addMsg(role, text, opts) {
      const div = document.createElement('div');
      div.className = 'rt-msg ' + role + (opts && opts.loading ? ' loading' : '');
      div.textContent = text;
      msgsEl.appendChild(div);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return div;
    }

    // Greeting
    addMsg('bot', 'Hi! I am Retlify AI. How can I help you today?');

    function openPanel() {
      panel.classList.add('open');
      setTimeout(function () { input.focus(); }, 50);
    }
    function closePanel() { panel.classList.remove('open'); }

    fab.addEventListener('click', function () {
      panel.classList.contains('open') ? closePanel() : openPanel();
    });
    panel.querySelector('#retlify-ai-close').addEventListener('click', closePanel);

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // Send message
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      addMsg('user', text);
      history.push({ role: 'user', content: text });
      input.value = '';
      sendBtn.disabled = true;

      const loading = addMsg('bot', 'Thinking...', { loading: true });

      try {
        const token   = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;

        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            messages: history.slice(-10),
            mode:     'customer',
            context:  {},
          }),
        });

        let reply = '';
        if (res.ok) {
          const data = await res.json();
          reply = data.reply || data.message || data.text
               || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
               || 'Hmm, I did not get a response. Try again?';
        } else if (res.status === 429) {
          reply = 'Too many messages in a short time. Please wait a moment.';
        } else {
          reply = 'Sorry, the AI service is temporarily unavailable.';
        }

        loading.classList.remove('loading');
        loading.textContent = reply;
        history.push({ role: 'assistant', content: reply });
      } catch (err) {
        loading.classList.remove('loading');
        loading.textContent = 'Network error. Please check your connection and try again.';
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  /* ------------------------------------------------------------ */
  /* Bootstrap                                                    */
  /* ------------------------------------------------------------ */
  function start() {
    try { refreshProfile(); } catch (e) { console.warn(e); }
    try { wireNotificationOutsideClose(); } catch (e) { console.warn(e); }
    try { injectChatWidget(); } catch (e) { console.warn(e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
