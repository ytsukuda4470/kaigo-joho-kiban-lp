import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useNavigation } from '@react-navigation/native';

const STATUS_COLORS: Record<string, string> = {
  '新規': '#e53e3e',
  '対応中': '#d69e2e',
  '現地訪問済': '#3182ce',
  '完了': '#38a169',
  'フォロー中': '#805ad5',
};

export function InquiryListScreen() {
  const navigation = useNavigation<any>();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const unsub = firestore()
      .collection('inquiries')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .onSnapshot(snap => {
        setInquiries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      });
    return unsub;
  }, []);

  const filtered = inquiries.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        (item.corp || '').toLowerCase().includes(q) ||
        (item.office || '').toLowerCase().includes(q) ||
        (item.name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#2b6cb0" />
    </View>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="法人名・事業所名・担当者で検索"
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
      />
      <View style={styles.filterRow}>
        {['all', '新規', '対応中', '完了'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterBtn, statusFilter === s && styles.filterBtnActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
              {s === 'all' ? '全て' : s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('InquiryDetail', { id: item.id })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.corpName}>{item.corp || item.office || '未設定'}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] || '#718096' }]}>
                <Text style={styles.badgeText}>{item.status || '新規'}</Text>
              </View>
            </View>
            <Text style={styles.officeName}>{item.office}</Text>
            <Text style={styles.name}>{item.name} 様</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>該当する問い合わせがありません</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f6f0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  search: {
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e0',
    backgroundColor: '#fff',
  },
  filterBtnActive: {
    backgroundColor: '#2b6cb0',
    borderColor: '#2b6cb0',
  },
  filterText: { fontSize: 12, color: '#4a5568' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  corpName: { fontSize: 15, fontWeight: '700', color: '#1a202c', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  officeName: { fontSize: 13, color: '#4a5568', marginTop: 4 },
  name: { fontSize: 12, color: '#718096', marginTop: 2 },
  emptyText: { color: '#718096', fontSize: 14 },
});
