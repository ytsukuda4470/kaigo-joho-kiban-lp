import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import auth from '@react-native-firebase/auth';

export function SettingsScreen() {
  const user = auth().currentUser;

  const signOut = () => {
    Alert.alert('ログアウト', 'ログアウトしますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: () => auth().signOut(),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {user?.photoURL && (
          <Image source={{ uri: user.photoURL }} style={styles.avatar} />
        )}
        <Text style={styles.displayName}>{user?.displayName || 'ユーザー'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>アプリ情報</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>バージョン</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Firebase</Text>
          <Text style={styles.rowValue}>kaigo-kiban-pm</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Text style={styles.signOutText}>ログアウト</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f6f0', padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, marginBottom: 12 },
  displayName: { fontSize: 18, fontWeight: '700', color: '#1a202c' },
  email: { fontSize: 13, color: '#718096', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#4a5568', alignSelf: 'flex-start', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 6 },
  rowLabel: { fontSize: 13, color: '#718096' },
  rowValue: { fontSize: 13, color: '#2d3748' },
  signOutBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fc8181',
  },
  signOutText: { color: '#e53e3e', fontSize: 15, fontWeight: '600' },
});
