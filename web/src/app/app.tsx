import { useHub } from '../entities/hub/hub-store';
import { HubPage } from '../pages/hub/hub-page';
import { LoginPage } from '../pages/login/login-page';

export function App() {
   const token = useHub((state) => state.token);
   return token ? <HubPage /> : <LoginPage />;
}
