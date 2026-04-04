import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { uploadPhoto } from '../utils/uploadPhoto';

const ACTION_TYPES = ['電話', '訪問', 'メール送信', '打ち合わせ', 'その他'];

export function ActionCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { inquiryId } = route.params;

  const [type, setType] = useState('電話');
  const [content, setContent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number[]>([]);

  const pickImage = async (useCamera: boolean) => {
    const { status } = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('権限が必要です', '設定アプリから権限を許可してください');
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.9, allowsMultipleSelection: true });

    if (!result.canceled) {
      const uris = result.assets.map(a => a.uri);
      setPhotos(prev => [...prev, ...uris]);
    }
  };

  const save = async () => {
    if (!content.trim()) {
      Alert.alert('エラー', '対応内容を入力してください');
      return;
    }
    setSaving(true);
    try {
      // 写真を順番にアップロード
      setUploadProgress(photos.map(() => 0));
      const photoUrls = await Promise.all(
        photos.map((uri, i) =>
          uploadPhoto(uri, inquiryId, (pct) => {
            setUploadProgress(prev => {
              const next = [...prev];
              next[i] = pct;
              return next;
            });
          })
        )
      );

      const user = auth().currentUser;
      await firestore().collection('actions').add({
        inquiryId,
        type,
        content: content.trim(),
        photoUrls,
        staff: user?.email || '',
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      // 訪問の場合はステータスを更新
      const updates: any = { updatedAt: firestore.FieldValue.serverTimestamp() };
      if (type === '訪問') updates.status = '現地訪問済';
      await firestore().collection('inquiries').doc(inquiryId).update(updates);

      navigation.goBack();
    } catch (e: any) {
      Alert.alert('保存エラー', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
      {/* 対応種別 */}
      <View style={styles.section}>
        <Text style={styles.label}>対応種別</Text>
        <View style={styles.typeRow}>
          {ACTION_TYPES.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.typeBtn, type === t && styles.typeBtnActive]}
              onPress={() => setType(t)}
            >
              <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 対応内容 */}
      <View style={styles.section}>
        <Text style={styles.label}>対応内容</Text>
        <TextInput
          style={styles.textarea}
          multiline
          numberOfLines={6}
          placeholder="対応内容を入力..."
          value={content}
          onChangeText={setContent}
          textAlignVertical="top"
        />
      </View>

      {/* 写真 */}
      <View style={styles.section}>
        <Text style={styles.label}>写真（任意）</Text>
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(true)}>
            <Text style={styles.photoBtnText}>📷 カメラ撮影</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(false)}>
            <Text style={styles.photoBtnText}>🖼️ ライブラリ</Text>
          </TouchableOpacity>
        </View>
        {photos.length > 0 && (
          <View style={styles.photoGrid}>
            {photos.map((uri, i) => (
              <View key={i} style={styles.photoWrapper}>
                <Image source={{ uri }} style={styles.photoThumb} />
                {saving && uploadProgress[i] !== undefined && uploadProgress[i] < 1 && (
                  <View style={styles.progressOverlay}>
                    <Text style={styles.progressText}>{Math.round(uploadProgress[i] * 100)}%</Text>
                  </View>
                )}
                {!saving && (
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => setPhotos(p => p.filter((_, j) => j !== i))}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 保存ボタン */}
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={save}
        disabled={saving}
      >
        {saving ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.saveBtnText}>
              {photos.length > 0 ? '写真をアップロード中...' : '保存中...'}
            </Text>
          </View>
        ) : (
          <Text style={styles.saveBtnText}>保存する</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f6f0' },
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
  label: { fontSize: 13, fontWeight: '600', color: '#4a5568', marginBottom: 10 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e0',
    backgroundColor: '#fff',
  },
  typeBtnActive: { backgroundColor: '#2b6cb0', borderColor: '#2b6cb0' },
  typeBtnText: { fontSize: 13, color: '#4a5568' },
  typeBtnTextActive: { color: '#fff', fontWeight: '600' },
  textarea: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#2d3748',
    minHeight: 130,
  },
  photoRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  photoBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e0',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#f7fafc',
  },
  photoBtnText: { fontSize: 14 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoWrapper: { position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: 8 },
  progressOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#e53e3e',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: '#2b6cb0',
    margin: 12,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
