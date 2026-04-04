import { useEffect, useState } from 'react';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null | undefined>(undefined);

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  return { user, loading: user === undefined };
}
