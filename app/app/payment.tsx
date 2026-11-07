import { Redirect } from 'expo-router';

// Old deep links must not charge again for workspace access.
export default function Payment() {
  return <Redirect href="/models" />;
}
