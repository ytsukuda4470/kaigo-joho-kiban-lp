import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';

export interface Inquiry {
  id: string;
  corp: string;
  office: string;
  name: string;
  email: string;
  phone: string;
  prefecture: string;
  status: string;
  assignee: string;
  message: string;
  interest: string;
  createdAt: any;
  updatedAt: any;
}

export function useInquiries() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = firestore()
      .collection('inquiries')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .onSnapshot(
        snap => {
          setInquiries(snap.docs.map(d => ({ id: d.id, ...d.data() } as Inquiry)));
          setLoading(false);
        },
        err => {
          console.warn('useInquiries error:', err.message);
          setLoading(false);
        }
      );
    return unsub;
  }, []);

  return { inquiries, loading };
}

export function useInquiryDetail(id: string) {
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubInquiry = firestore()
      .collection('inquiries')
      .doc(id)
      .onSnapshot(snap => setInquiry({ id: snap.id, ...snap.data() } as Inquiry));

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

    return () => { unsubInquiry(); unsubActions(); unsubFollowups(); };
  }, [id]);

  return { inquiry, actions, followups, loading };
}
