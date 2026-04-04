import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';

export function FollowupListScreen() {
  const [followups, setFollowups] = useState<any[]>([]);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');

  useEffect(() => {
    const unsub = firestore()
      .collection('followups')
      .orderBy('dueDate', 'asc')
      .onSnapshot(snap => setFollowups(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filtered = followups.filter(f =>
    tab === 'pending' ? f.status !== '完了' : f.status === '完了'
  );

  const complete = async (id: string, subject: string) => {
    Alert.alert('完了にする', subject, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '完了',
        onPress: () =>
          firestore().collection('followups').doc(id).update({
            status: '完了',
            completedAt: firestore.FieldValue.serverTimestamp(),
          }),
      },
    ]);
  };

  const getDueBadgeStyle = (dueDate: any) => {
    const due = dueDate?.toDate?.() || new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    if (due < today) return styles.overdue;
    if (due.getTime() === today.getTime()) return styles.today;
    return styles.future;
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['pending', 'done'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'pending' ? '未完了' : '完了済み'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const dueBadge = item.status !== '完了' ? getDueBadgeStyle(item.dueDate) : null;
          return (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                {dueBadge && (
                  <View style={[styles.dueBadge, dueBadge]}>
                    <Text style={styles.dueBadgeText}>
                      {dueBadge === styles.overdue ? '期限切れ' : dueBadge === styles.today ? '今日' : '予定'}
                    </Text>
                  </View>
                )}
                <Text style={styles.subject}>{item.subject}</Text>
                <Text style={styles.corp}>{item.corp} / {item.office}</Text>
                <Text style={styles.due}>
                  {item.dueDate?.toDate?.().toLocaleDateString('ja-JP') || item.dueDate}
                </Text>
              </View>
              {item.status !== '完了' && (
                <TouchableOpacity
                  style={styles.completeBtn}
                  onPress={() => complete(item.id, item.subject)}
                >
                  <Text style={styles.completeBtnText}>完了</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === 'pending' ? '未完了のフォローアップはありません' : '完了済みがありません'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f6f0' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#2b6cb0' },
  tabText: { fontSize: 14, color: '#718096' },
  tabTextActive: { color: '#2b6cb0', fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLeft: { flex: 1 },
  dueBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 4 },
  overdue: { backgroundColor: '#fed7d7' },
  today: { backgroundColor: '#fefcbf' },
  future: { backgroundColor: '#bee3f8' },
  dueBadgeText: { fontSize: 11, fontWeight: '600', color: '#2d3748' },
  subject: { fontSize: 14, fontWeight: '600', color: '#2d3748' },
  corp: { fontSize: 12, color: '#718096', marginTop: 2 },
  due: { fontSize: 12, color: '#a0aec0', marginTop: 2 },
  completeBtn: {
    backgroundColor: '#38a169',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 10,
  },
  completeBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#a0aec0', padding: 32, fontSize: 14 },
});
