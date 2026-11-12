// frontend/auth-guard.js
function requireAuth(allowedRoles = []) {
  const token = localStorage.getItem('access_token');
  const role = localStorage.getItem('user_role');

  // 1. Check if token exists
  if (!token) {
    window.location.href = '/login.html';
    return null;
  }

  // 2. Check role authorization if roles are specified
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    alert('Access Denied: You do not have permission to view this portal.');
    
    // Redirect user to their own valid portal
    if (role === 'CREATOR') window.location.href = '/creator/dashboard.html';
    else if (role === 'BRAND_ADMIN') window.location.href = '/brand/dashboard.html';
    else window.location.href = '/admin/dashboard.html';
    return null;
  }

  return { token, role };
}

function logoutUser() {
  localStorage.clear();
  window.location.href = '/login.html';
}

// Utility to attach the Bearer token to API requests
function authFetch(url, options = {}) {
  const token = localStorage.getItem('access_token');
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}