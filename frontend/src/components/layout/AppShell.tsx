import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/authentication/useAuth';
import { BrandMark } from './BrandMark';
import { CosmicBackground } from './CosmicBackground';

const HOST_LINKS = [
  { to: '/host', label: 'Command Center', end: true },
  { to: '/host/questions', label: 'Question Bank' },
  { to: '/host/questions/import', label: 'Import' },
  { to: '/host/competitions', label: 'Competitions' },
];

const STUDENT_LINKS = [{ to: '/student', label: 'Dashboard', end: true }];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const links = user?.role === 'host' ? HOST_LINKS : user?.role === 'student' ? STUDENT_LINKS : [];

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <CosmicBackground />
      <header className="topbar">
        <div className="topbar__inner">
          <Link to={user?.role === 'host' ? '/host' : user ? '/student' : '/'} className="brand" aria-label="MathHack home">
            <BrandMark />
            <span>MATH<span className="brand__accent">HACK</span></span>
          </Link>
          <button
            type="button"
            className="btn btn--ghost icon-btn topbar__menu-btn"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="visually-hidden">Menu</span>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <nav id="primary-nav" className={`topbar__nav ${menuOpen ? 'open' : ''}`} aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end}>{link.label}</NavLink>
            ))}
            {user ? (
              <>
                <span className="muted small" style={{ padding: '0 8px' }}>{user.name}</span>
                <button type="button" className="btn btn--small" onClick={handleLogout}>Log out</button>
              </>
            ) : (
              <>
                <NavLink to="/login">Student login</NavLink>
                <NavLink to="/register">Register</NavLink>
                <NavLink to="/host/login">Host</NavLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer">MathHack · A fan-inspired competition platform, not affiliated with Marvel or Disney.</footer>
    </div>
  );
}
