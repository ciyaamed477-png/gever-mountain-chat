import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/use-auth";
import AuthPage from "./pages/Auth";
import ChatsPage from "./pages/Chats";
import ChatPage from "./pages/Chat";
import ContactsPage from "./pages/Contacts";
import ProfilePage from "./pages/Profile";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";
import AppShell from "./components/AppShell";
import { GlobalMessageListener } from "./components/GlobalMessageListener";
import SplashScreen from "./components/SplashScreen";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/auth" replace />;
  return (
    <>
      <GlobalMessageListener />
      {children}
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppShell>
              <ChatsPage />
            </AppShell>
          </Protected>
        }
      />
      <Route
        path="/contacts"
        element={
          <Protected>
            <AppShell>
              <ContactsPage />
            </AppShell>
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <AppShell>
              <ProfilePage />
            </AppShell>
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <AppShell>
              <SettingsPage />
            </AppShell>
          </Protected>
        }
      />
      <Route
        path="/chat/:conversationId"
        element={
          <Protected>
            <ChatPage />
          </Protected>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
