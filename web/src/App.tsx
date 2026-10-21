import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { Feed } from './pages/Feed';
import { Profile, YouRedirect } from './pages/Profile';
import { Search } from './pages/Search';
import { SessionDetail } from './pages/SessionDetail';
import { Record } from './pages/record/Record';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Feed />} />
        <Route path="/record" element={<Record />} />
        <Route path="/s/:id" element={<SessionDetail />} />
        <Route path="/u/:username" element={<Profile />} />
        <Route path="/you" element={<YouRedirect />} />
        <Route path="/search" element={<Search />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
