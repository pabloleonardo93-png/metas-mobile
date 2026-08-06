import { Redirect } from 'expo-router';

import { appRoutes } from '@/config/routes';

export default function Index() {
  return <Redirect href={appRoutes.login} />;
}
