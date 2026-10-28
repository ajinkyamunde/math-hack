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
      <div className="landing-hero-minimal mh-animate-in">
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
