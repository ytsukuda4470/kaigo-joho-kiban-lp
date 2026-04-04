import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import { useNavigation, useRoute } from '@react-navigation/native';

export function InquiryDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { id } = route.params;
  const [inquiry, setInquiry] = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = firestore().collection('inquiries').doc(id).onSnapshot(snap => {
      setInquiry({ id: snap.id, ...snap.data() });
    });
    const unsubActions = firestore()
      .collection('actions')
      .where('inquiryId', '==', id)
      .orderBy('createdAt', 'desc')
      .onSnapshot(snap => setActions(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubFollowups = firestore()
      .collection('followups')
      .where('inquiryId', '==', id)
      .orderBy('dueDate', 'asc')
      .onSnapshot(snap => {
        setFollowups(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      });
    return () => { unsub(); unsubActions(); unsubFollowups(); };
  }, [id]);

  const completeFollowup = async (followupId: string) => {
    await firestore().collection('followups').doc(followupId).update({
      status: '完了',
      completedAt: firestore.FieldValue.serverTimestamp(),
    });
  };

  if (loading || !inquiry) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#2b6cb0" />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* 基本情報 */}
      <View style={styles.section}>
        <Text style={styles.corpName}>{inquiry.corp}</Text>
        <Text style={styles.officeName}>{inquiry.office}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>担当者</Text>
          <Text style={styles.value}>{inquiry.name} 様</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>電話</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${inquiry.phone}`)}>
            <Text style={[styles.value, styles.link]}>{inquiry.phone}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>メール</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${inquiry.email}`)}>
            <Text style={[styles.value, styles.link]}>{inquiry.email}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>ステータス</Text>
          <Text style={styles.value}>{inquiry.status || '新規'}</Text>
        </View>
      </View>

      {/* フォローアップ */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>フォローアップ</Text>
      </View>
      {followups.filter(f => f.status !== '完了').map(f => (
        <View key={f.id} style={styles.followupCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.followupSubject}>{f.subject}</Text>
            <Text style={styles.followupDue}>期日: {f.dueDate?.toDate?.().toLocaleDateString('ja-JP') || f.dueDate}</Text>
          </View>
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={() => Alert.alert('完了にする', f.subject, [
              { text: 'キャンセル', style: 'cancel' },
              { text: '完了', onPress: () => completeFollowup(f.id) },
            ])}
          >
            <Text style={styles.completeBtnText}>完了</Text>
          </TouchableOpacity>
        </View>
      ))}
      {followups.filter(f => f.status !== '完了').length === 0 && (
        <Text style={styles.emptyText}>未完了のフォローアップはありません</Text>
      )}

      {/* 対応履歴 */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>対応履歴</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('ActionCreate', { inquiryId: id })}
        >
          <Text style={styles.addBtnText}>＋ 記録追加</Text>
        </TouchableOpacity>
      </View>
      {actions.map(a => (
        <View key={a.id} style={styles.actionCard}>
          <View style={styles.actionHeader}>
            <Text style={styles.actionType}>{a.type}</Text>
            <Text style={styles.actionDate}>
              {a.createdAt?.toDate?.().toLocaleString('ja-JP') || ''}
            </Text>
          </View>
          <Text style={styles.actionContent}>{a.content}</Text>
          {a.staff && <Text style={styles.actionStaff}>{a.staff}</Text>}
        </View>
      ))}
      {actions.length === 0 && (
        <Text style={styles.emptyText}>対応履歴がありません</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f6f0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#2d3748' },
  corpName: { fontSize: 18, fontWeight: '800', color: '#1a202c', marginBottom: 4 },
  officeName: { fontSize: 14, color: '#4a5568', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  label: { width: 64, fontSize: 12, color: '#718096' },
  value: { fontSize: 14, color: '#2d3748', flex: 1 },
  link: { color: '#2b6cb0', textDecorationLine: 'underline' },
  followupCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    borderLeftColor: '#d69e2e',
  },
  followupSubject: { fontSize: 14, fontWeight: '600', color: '#2d3748' },
  followupDue: { fontSize: 12, color: '#718096', marginTop: 2 },
  completeBtn: {
    backgroundColor: '#38a169',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  completeBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  actionCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
  },
  actionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  actionType: { fontSize: 12, fontWeight: '600', color: '#2b6cb0' },
  actionDate: { fontSize: 11, color: '#a0aec0' },
  actionContent: { fontSize: 13, color: '#4a5568', lineHeight: 20 },
  actionStaff: { fontSize: 11, color: '#a0aec0', marginTop: 4 },
  emptyText: { textAlign: 'center', color: '#a0aec0', fontSize: 13, padding: 16 },
  addBtn: {
    backgroundColor: '#2b6cb0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
