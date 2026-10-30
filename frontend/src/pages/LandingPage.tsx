import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/authentication/useAuth';

export function LandingPage() {
  const { user } = useAuth();

  useEffect(() => {
    document.body.classList.add('page-landing');
    return () => {
      document.body.classList.remove('page-landing');
    };
  }, []);

  return (
    <div className="landing-page">
      <div className="landing-page-bg" aria-hidden="true" />
      <div className="landing-hero-minimal">
        {/* MATHHACK Split Entrance Animation */}
        <div className="mathhack-split-container" role="banner" aria-label="MATHHACK">
          <div className="split-block split-block--math">
            <img src="/logo_math.png" alt="MATH" width="482" height="216" />
          </div>
          <div className="split-block split-block--hack">
            <img src="/logo_hack.png" alt="HACK" width="479" height="217" />
          </div>
        </div>

        {/* Short Tagline */}
        <p className="landing-tagline">
          Think Fast. Solve Smart. Win Big.
        </p>

        {/* Three Primary Actions in Full Avengers Colors */}
        <div className="landing-actions-minimal" role="group" aria-label="Main actions">
          {user ? (
            <Link to={user.role === 'host' ? '/host' : '/student'} className="btn btn--avengers-gold btn--minimal">
              {user.role === 'host' ? 'Open Command Center' : 'Go to Dashboard'}
            </Link>
          ) : null}
          <Link to="/register" className="btn btn--avengers-red btn--minimal">
            Register
          </Link>
          <Link to="/login" className="btn btn--avengers-blue btn--minimal">
            Student Login
          </Link>
          <Link to="/host/login" className="btn btn--avengers-gold btn--minimal">
            Host Login
          </Link>
        </div>
      </div>
    </div>
  );
}
