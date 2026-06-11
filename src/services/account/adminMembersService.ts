import {
  collection, getDocs, orderBy, query, Firestore,
} from 'firebase/firestore';
import { FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Member, MemberRole } from '../../types/member';

export async function listAllMembers(db: Firestore): Promise<Member[]> {
  const col = collection(db, 'members');
  const q = query(col, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      email: data.email || '',
      fullName: data.fullName || null,
      role: data.role || 'unverified',
      phoneNumber: data.phoneNumber || '',
      emailVerified: data.emailVerified || false,
      provider: data.provider || 'unknown',
      createdAt: data.createdAt || null,
      lastLogin: data.lastLogin || null,
      updatedAt: data.updatedAt || null,
    };
  });
}

export async function setMemberRole(
  app: FirebaseApp,
  email: string,
  role: MemberRole,
): Promise<{ ok: boolean; uid: string; role: MemberRole }> {
  const functions = getFunctions(app);
  const callable = httpsCallable<
    { email: string; role: MemberRole },
    { ok: boolean; uid: string; role: MemberRole }
  >(functions, 'setMemberRole');
  const result = await callable({ email, role });
  return result.data;
}
