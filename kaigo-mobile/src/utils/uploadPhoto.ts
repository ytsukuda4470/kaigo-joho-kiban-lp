import storage from '@react-native-firebase/storage';
import auth from '@react-native-firebase/auth';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * ローカル画像を圧縮してFirebase Storageにアップロードし、ダウンロードURLを返す。
 * パス: inquiry-photos/{inquiryId}/{YYYYMMDD_HHmmss}_{uid6}.jpg
 */
export async function uploadPhoto(
  localUri: string,
  inquiryId: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  // リサイズ・圧縮（長辺1280px、JPEG 80%）
  const compressed = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1280 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );

  const user = auth().currentUser;
  const uid6 = user?.uid.slice(0, 6) || 'anon';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const path = `inquiry-photos/${inquiryId}/${dateStr}_${uid6}.jpg`;

  const ref = storage().ref(path);
  const task = ref.putFile(compressed.uri);

  if (onProgress) {
    task.on('state_changed', snapshot => {
      const pct = snapshot.bytesTransferred / snapshot.totalBytes;
      onProgress(pct);
    });
  }

  await task;
  return await ref.getDownloadURL();
}
