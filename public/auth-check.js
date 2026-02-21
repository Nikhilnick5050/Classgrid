(function () {
    // Configuration
    const API_BASE_URL = window.location.origin.includes('localhost')
        ? 'http://localhost:3000'
        : window.location.origin;
    const PROFILE_API = `${API_BASE_URL}/api/user/profile`;
    const TOKEN_KEY = 'jwt_token';
    const USER_KEY = 'user'; // Matches login.html

    // Global state for other scripts
    window.Auth = {
        user: null,
        token: null,
        isAuthenticated: false,
        logout: logout
    };

    // AuthUtils Compatibility Layer for legacy protection scripts
    window.AuthUtils = {
        isUserLoggedIn: () => window.Auth.isAuthenticated,
        getUserData: () => window.Auth.user,
        getJWTToken: () => window.Auth.token,
        logout: (reload = true) => window.Auth.logout(reload),
        showToast: (msg, type) => {
            if (typeof window.showToast === 'function') window.showToast(msg, type);
            else console.log(`Toast (${type}): ${msg}`);
        },
        showLoginModal: (msg) => {
            if (typeof window.showLoginModal === 'function') window.showLoginModal(msg);
            else {
                const modal = document.getElementById('loginModal');
                if (modal) modal.classList.add('active');
                else alert(msg || 'Please login to access this feature');
            }
        },
        API_BASE: API_BASE_URL
    };

    // Initialize
    async function initAuth() {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            updateUI(null);
            updatePageSpecificUI(false);
            return;
        }

        window.Auth.token = token;

        // Try to get user from local storage first for speed
        try {
            const cachedUser = localStorage.getItem(USER_KEY);
            if (cachedUser) {
                const user = JSON.parse(cachedUser);
                window.Auth.user = user;
                window.Auth.isAuthenticated = true;
                updateUI(user);
                updatePageSpecificUI(true);
            }
        } catch (e) {
            console.error("Error parsing cached user", e);
        }

        // Verify with API
        try {
            const response = await fetch(PROFILE_API, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const user = data.user;

                // Update cache
                localStorage.setItem(USER_KEY, JSON.stringify(user));
                window.Auth.user = user;
                window.Auth.isAuthenticated = true;
                updateUI(user);
                updatePageSpecificUI(true);
            } else {
                // Token invalid
                console.warn('Session expired');
                // Only clear if api explicitly fails
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(USER_KEY);
                updateUI(null);
                updatePageSpecificUI(false);
            }
        } catch (error) {
            console.error('Auth verification failed', error);
            // If network error, keep cached user if we have it
        }
    }

    function updateUI(user) {
        // 1. Chemicals Style (#userDropdown)
        const userDropdown = document.getElementById('userDropdown');
        if (userDropdown) {
            if (user) {
                // Logged In
                const avatar = document.getElementById('userAvatar');
                const name = document.getElementById('userName');
                const dropdownContent = document.getElementById('dropdownContent');

                const avatarUrl = user.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=3B82F6&color=fff`;

                if (avatar) avatar.src = avatarUrl;
                if (name) name.textContent = user.name;

                if (dropdownContent) {
                    // Using innerHTML to replace Sign In/Sign Up with Profile/Logout
                    dropdownContent.innerHTML = `
                        <div style="padding:10px 15px; border-bottom:1px solid #eee;">
                            <strong>${user.name}</strong>
                        </div>
                        <a href="classroom.html" class="dropdown-item">
                            <i class="fas fa-user"></i> <span>Profile</span>
                        </a>
                        <div class="dropdown-divider"></div>
                        <a href="#" class="dropdown-item" onclick="window.Auth.logout()">
                            <i class="fas fa-sign-out-alt"></i> <span>Logout</span>
                        </a>
                    `;
                }
            } else {
                // Ensure default state (optional, HTML usually has it)
            }
        }

        // 2. Lecture/Tutorials Style (#navAuthSection)
        const navAuthSection = document.getElementById('navAuthSection');
        const mobileAuthSection = document.getElementById('mobileAuthSection');

        if (navAuthSection || mobileAuthSection) {
            if (user) {
                const avatarUrl = user.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=3B82F6&color=fff`;

                if (navAuthSection) {
                    navAuthSection.innerHTML = `
                        <div class="user-nav-section">
                            <a href="classroom.html" class="user-avatar-nav" title="Dashboard">
                                <img src="${avatarUrl}" alt="${user.name}">
                            </a>
                            <span class="user-name-nav" style="margin-left:8px; font-weight:600; color:var(--text-light, #e2e8f0);">${user.name}</span>
                            <button onclick="window.Auth.logout()" class="logout-btn-nav" title="Logout">
                                <i class="fas fa-sign-out-alt"></i>
                            </button>
                        </div>
                    `;
                }

                if (mobileAuthSection) {
                    mobileAuthSection.innerHTML = `
                        <div class="mobile-user-section">
                            <div class="mobile-user-avatar">
                                <img src="${avatarUrl}" alt="${user.name}">
                            </div>
                            <div class="mobile-user-name">${user.name}</div>
                            <div class="mobile-user-email">${user.email}</div>
                             <button onclick="window.Auth.logout()" style="margin-top:10px; width:100%; padding:10px; background:rgba(239, 68, 68, 0.2); border:1px solid rgba(239, 68, 68, 0.4); color:#ef4444; border-radius:8px; cursor:pointer;">
                                <i class="fas fa-sign-out-alt"></i> Logout
                            </button>
                        </div>
                    `;
                }

            } else {
                // Not logged in
                const loginUrl = 'login.html';
                if (navAuthSection) {
                    navAuthSection.innerHTML = `
                        <div class="auth-buttons">
                            <a href="${loginUrl}" class="auth-btn auth-btn-outline">Login</a>
                            <a href="${loginUrl}?action=signup" class="auth-btn auth-btn-primary">Sign Up</a>
                        </div>
                    `;
                }
                if (mobileAuthSection) {
                    mobileAuthSection.innerHTML = `
                       <div style="margin-bottom: 20px; display:flex; flex-direction:column; gap:10px;">
                            <a href="${loginUrl}" style="background: white; color: #1a1f3a; padding:12px; border-radius:10px; text-align:center; text-decoration:none; font-weight:bold;">
                                Login
                            </a>
                            <a href="${loginUrl}?action=signup" style="background: linear-gradient(135deg, #00d4ff 0%, #b24bf3 100%); color:white; padding:12px; border-radius:10px; text-align:center; text-decoration:none; font-weight:bold;">
                                Sign Up
                            </a>
                        </div>
                     `;
                }
            }
        }

        // 3. Chemistry Style (#loggedInUserInfo)
        const loggedInUserInfo = document.getElementById('loggedInUserInfo');
        if (loggedInUserInfo) {
            if (user) {
                const avatarUrl = user.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=3B82F6&color=fff`;

                loggedInUserInfo.innerHTML = `
                    <div class="logged-user-info" style="display:flex; align-items:center; gap:10px; padding:0.5rem; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:12px;">
                        <div class="logged-user-avatar" style="width:36px; height:36px; border-radius:8px; overflow:hidden;">
                            <img src="${avatarUrl}" alt="${user.name}" style="width:100%; height:100%; object-fit:cover;">
                        </div>
                        <div class="logged-user-details" style="display:flex; flex-direction:column;">
                            <div class="logged-user-name" style="font-weight:700; font-size:0.9rem;">${user.name}</div>
                        </div>
                         <button onclick="window.Auth.logout()" style="margin-left:5px; border:none; background:none; cursor:pointer; color:var(--error); padding:5px;" title="Logout">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                `;
            } else {
                // If not logged in, maybe show Login button or keep empty?
                // Checking if existing content is empty or placeholder
                loggedInUserInfo.innerHTML = `
                    <a href="login.html" style="text-decoration:none; color:var(--text-primary); font-weight:600; padding:0.5rem 1rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-secondary);">
                        <i class="fas fa-sign-in-alt"></i> Login
                    </a>
                 `;
            }
        }
    }

    function updatePageSpecificUI(isAuthenticated) {
        // Trigger custom event for page-specific logic (like Tutorials lock)
        window.dispatchEvent(new CustomEvent('auth-updated', { detail: { isAuthenticated } }));

        // Also explicitly call re-render functions if they exist in global scope
        if (typeof window.renderTutorials === 'function') {
            window.renderTutorials();
        }
        if (typeof window.renderUnits === 'function') {
            window.renderUnits();
        }
    }

    function logout(reload = true) {
        if (reload && !confirm('Are you sure you want to logout?')) return;

        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('qc_user');

        window.Auth.user = null;
        window.Auth.token = null;
        window.Auth.isAuthenticated = false;

        if (reload) window.location.reload();
        else updateUI(null);
    }

    // Run on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }

})();
