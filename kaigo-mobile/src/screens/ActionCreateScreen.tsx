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
import storage from '@react-native-firebase/storage';
import auth from '@react-native-firebase/auth';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation, useRoute } from '@react-navigation/native';

const ACTION_TYPES = ['電話', '訪問', 'メール送信', '打ち合わせ', 'その他'];

export function ActionCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { inquiryId } = route.params;

  const [type, setType] = useState('電話');
  const [content, setContent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const pickImage = async (useCamera: boolean) => {
    const { status } = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('権限が必要です', '設定アプリから権限を許可してください');
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPhotos(prev => [...prev, compressed.uri]);
    }
  };

  const uploadPhoto = async (localUri: string): Promise<string> => {
    const user = auth().currentUser;
    const uid6 = user?.uid.slice(0, 6) || 'anon';
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const path = `inquiry-photos/${inquiryId}/${dateStr}_${uid6}.jpg`;
    const ref = storage().ref(path);
    await ref.putFile(localUri);
    return await ref.getDownloadURL();
  };

  const save = async () => {
    if (!content.trim()) {
      Alert.alert('エラー', '対応内容を入力してください');
      return;
    }
    setSaving(true);
    try {
      const photoUrls = await Promise.all(photos.map(uploadPhoto));
      const user = auth().currentUser;
      await firestore().collection('actions').add({
        inquiryId,
        type,
        content: content.trim(),
        photoUrls,
        staff: user?.email || '',
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
      await firestore().collection('inquiries').doc(inquiryId).update({
        status: type === '訪問' ? '現地訪問済' : undefined,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('エラー', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
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

      <View style={styles.section}>
        <Text style={styles.label}>写真（任意）</Text>
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(true)}>
            <Text style={styles.photoBtnText}>📷 カメラ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(false)}>
            <Text style={styles.photoBtnText}>🖼️ ライブラリ</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.photoGrid}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.photoWrapper}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => setPhotos(p => p.filter((_, j) => j !== i))}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={save}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
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
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    minHeight: 120,
  },
  photoRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  photoBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e0',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  photoBtnText: { fontSize: 14 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoWrapper: { position: 'relative' },
  photoThumb: { width: 80, height: 80, borderRadius: 8 },
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
