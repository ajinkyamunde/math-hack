import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Loading } from '../components/common/Loading';
import { AppShell } from '../components/layout/AppShell';
import { RequireRole } from '../features/authentication/RequireRole';
import { CompetitionPage } from '../pages/CompetitionPage';
import { HostLoginPage } from '../pages/HostLoginPage';
import { LandingPage } from '../pages/LandingPage';
import { LeaderboardPage } from '../pages/LeaderboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { StudentDashboardPage } from '../pages/StudentDashboardPage';
import { StudentLoginPage } from '../pages/StudentLoginPage';
import { StudentRegisterPage } from '../pages/StudentRegisterPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

// Host screens (and the charting library) load on demand so students' phones download less.
const named = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, key: K) => lazy(() => loader().then((m) => ({ default: m[key] })));
const HostDashboardPage = named(() => import('../pages/HostDashboardPage'), 'HostDashboardPage');
const QuestionBankPage = named(() => import('../pages/QuestionBankPage'), 'QuestionBankPage');
const QuestionEditorPage = named(() => import('../pages/QuestionEditorPage'), 'QuestionEditorPage');
const ImportQuestionsPage = named(() => import('../pages/ImportQuestionsPage'), 'ImportQuestionsPage');
const CompetitionManagementPage = named(() => import('../pages/CompetitionManagementPage'), 'CompetitionManagementPage');
const CompetitionControlPage = named(() => import('../pages/CompetitionControlPage'), 'CompetitionControlPage');
const ResultsPage = named(() => import('../pages/ResultsPage'), 'ResultsPage');

const student = (element: ReactNode) => <RequireRole role="student">{element}</RequireRole>;
const host = (element: ReactNode) => (
  <RequireRole role="host">
    <Suspense fallback={<Loading />}>{element}</Suspense>
  </RequireRole>
);

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/register', element: <StudentRegisterPage /> },
      { path: '/login', element: <StudentLoginPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/student', element: student(<StudentDashboardPage />) },
      { path: '/student/competitions/:id', element: student(<CompetitionPage />) },
      { path: '/student/competitions/:id/leaderboard', element: student(<LeaderboardPage />) },
      { path: '/host/login', element: <HostLoginPage /> },
      { path: '/host', element: host(<HostDashboardPage />) },
      { path: '/host/questions', element: host(<QuestionBankPage />) },
      { path: '/host/questions/new', element: host(<QuestionEditorPage />) },
      { path: '/host/questions/import', element: host(<ImportQuestionsPage />) },
      { path: '/host/questions/:id/edit', element: host(<QuestionEditorPage />) },
      { path: '/host/competitions', element: host(<CompetitionManagementPage />) },
      { path: '/host/competitions/:id', element: host(<CompetitionControlPage />) },
      { path: '/host/competitions/:id/results', element: host(<ResultsPage />) },
      { path: '/dashboard', element: <Navigate to="/student" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
