document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
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

  form.addEventListener('submit', async (e) => {
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

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
  }
});
