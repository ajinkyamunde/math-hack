import { Link } from 'react-router-dom';
import { useAuth } from '../features/authentication/useAuth';

const FEATURES = [
  { title: 'Live on every phone', text: 'Questions appear on all participants’ screens the instant the host publishes them.' },
  { title: 'Server-timed fairness', text: 'One authoritative clock. Refreshing or reconnecting never resets a timer.' },
  { title: 'Instant analytics', text: 'Rankings, accuracy and solve times, exportable to Excel and CSV.' },
];

export function LandingPage() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero mh-animate-in">
        <div className="eyebrow">Mathematics · Real-time · Endgame edition</div>
        <h1 className="hero__title">MATHHACK</h1>
        <p className="hero__tagline">Assemble your mind. Answer under pressure. A live mathematical MCQ battle for your whole college, run from one command center.</p>
        <div className="hero__actions">
          {user ? (
            <Link to={user.role === 'host' ? '/host' : '/student'} className="btn btn--gold">
              {user.role === 'host' ? 'Open command center' : 'Go to my dashboard'}
            </Link>
          ) : (
            <>
              <Link to="/register" className="btn btn--gold">Register with PRN</Link>
              <Link to="/login" className="btn btn--primary">Student login</Link>
              <Link to="/host/login" className="btn">Host login</Link>
            </>
          )}
        </div>
      </section>
      <section className="grid grid--3" aria-label="Features">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="panel panel--holo mh-animate-in">
            <h2 style={{ fontSize: '1.05rem' }}>{feature.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{feature.text}</p>
          </article>
        ))}
      </section>
    </>
  );
}
