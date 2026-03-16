document.addEventListener('DOMContentLoaded', () => {
  const staffForm = document.getElementById('loginForm');
  const cleanerForm = document.getElementById('cleanerLoginForm');
  const errorMsg = document.getElementById('errorMsg');

  // Check for Google SSO error in URL
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'google_failed') {
    showError('Google login failed. Your account may not exist yet — contact your admin.');
  }

  // If already logged in, redirect
  fetch('/api/auth/me').then(async res => {
    if (res.ok) {
      const user = await res.json();
      window.location.href = user.role === 'cleaner' ? '/cleaner-portal.html' : '/';
    }
  }).catch(() => {});

  // Staff login
  staffForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.style.display = 'none';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = data.role === 'cleaner' ? '/cleaner-portal.html' : '/';
      } else {
        showError(data.error || 'Login failed');
      }
    } catch (err) {
      showError('Network error. Please try again.');
    }
  });

  // Cleaner PIN login
  cleanerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMsg.style.display = 'none';

    const phone = document.getElementById('cleanerPhone').value.replace(/\s+/g, '');
    const pinDigits = document.querySelectorAll('.pin-digit');
    const pin = Array.from(pinDigits).map(d => d.value).join('');

    if (pin.length !== 4) {
      showError('Please enter your 4-digit PIN');
      return;
    }

    try {
      const res = await fetch('/api/auth/cleaner-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin })
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/cleaner-portal.html';
      } else {
        showError(data.error || 'Login failed');
      }
    } catch (err) {
      showError('Network error. Please try again.');
    }
  });

  // PIN digit auto-advance
  const pinDigits = document.querySelectorAll('.pin-digit');
  pinDigits.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val;
      if (val && idx < 3) pinDigits[idx + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        pinDigits[idx - 1].focus();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 4);
      for (let i = 0; i < pasted.length && i < 4; i++) {
        pinDigits[i].value = pasted[i];
      }
      if (pasted.length > 0) pinDigits[Math.min(pasted.length, 3)].focus();
    });
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
  }
});

// Tab switching
function switchLoginTab(tab) {
  document.querySelectorAll('.login-tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.login-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.login-tabs button:nth-child(${tab === 'staff' ? 1 : 2})`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
  document.getElementById('errorMsg').style.display = 'none';
}
