import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../../components/SEO';
import AdminGuard from '../AdminGuard';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { useAuth } from '../../../services/hooks/useAuth';
import { Member, MemberRole } from '../../../types/member';
import {
  listAllMembers,
  setMemberRole,
} from '../../../services/account/adminMembersService';

const ROLES: MemberRole[] = ['unverified', 'member', 'admin'];

interface MembersLoadOutcome {
  firestore: unknown;
  status: 'loading' | 'resolved' | 'unavailable';
  members: Member[];
}

interface RoleActionOutcome {
  app: unknown;
  firestore: unknown;
  adminUid: string | null;
  status: 'pending' | 'unknown';
  targetEmail: string;
}

const LOAD_FAILURE = 'We could not load website accounts right now. Stop and contact the membership lead and platform owner before changing website access.';
const ROLE_CHANGE_UNKNOWN = 'We could not confirm that website access change. Do not repeat it. Stop and contact the membership lead and platform owner.';

function RolePill({ role }: { role: string }) {
  const style: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-800',
    member: 'bg-green-100 text-green-800',
    unverified: 'bg-gray-200 text-gray-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${style[role] || 'bg-gray-100'}`}>
      {role}
    </span>
  );
}

function fmtDate(ts: any) {
  if (!ts) return '';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Inner() {
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();
  const app = isReady && services
    ? services.firebaseResources.app
    : null;
  const firestore = isReady && services
    ? services.firebaseResources.firestore
    : null;
  const adminUid = user?.uid ?? null;
  const currentFirestoreRef = useRef(firestore);
  currentFirestoreRef.current = firestore;
  const currentActionContextRef = useRef({ app, firestore, adminUid });
  currentActionContextRef.current = { app, firestore, adminUid };
  const requestSequence = useRef(0);
  const roleActionSequence = useRef(0);
  const roleActionInFlight = useRef(false);
  const [loadOutcome, setLoadOutcome] = useState<MembersLoadOutcome | null>(null);
  const [roleActionOutcome, setRoleActionOutcome] = useState<RoleActionOutcome | null>(
    null,
  );
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | MemberRole>('all');

  const currentOutcome = loadOutcome?.firestore === firestore ? loadOutcome : null;
  const currentStatus = currentOutcome?.status ?? 'loading';
  const members = currentOutcome?.status === 'resolved' ? currentOutcome.members : [];
  const currentRoleAction = roleActionOutcome?.app === app
    && roleActionOutcome.firestore === firestore
    && roleActionOutcome.adminUid === adminUid
    ? roleActionOutcome
    : null;
  const roleActionPending = currentRoleAction?.status === 'pending';
  const roleActionUnknown = currentRoleAction?.status === 'unknown';
  const showAccountResults = currentStatus === 'resolved' && !roleActionUnknown;

  const reload = useCallback(async () => {
    if (!firestore || currentFirestoreRef.current !== firestore) return;
    requestSequence.current += 1;
    const requestId = requestSequence.current;
    const outcomeKey = { firestore };
    setLoadOutcome({ ...outcomeKey, status: 'loading', members: [] });
    try {
      const all = await listAllMembers(firestore);
      if (requestId !== requestSequence.current
        || currentFirestoreRef.current !== firestore) return;
      setLoadOutcome({ ...outcomeKey, status: 'resolved', members: all });
    } catch {
      if (requestId !== requestSequence.current
        || currentFirestoreRef.current !== firestore) return;
      setLoadOutcome({ ...outcomeKey, status: 'unavailable', members: [] });
    }
  }, [firestore]);

  useEffect(() => {
    if (!firestore) {
      requestSequence.current += 1;
      return () => undefined;
    }
    reload();
    return () => { requestSequence.current += 1; };
  }, [firestore, reload]);

  useLayoutEffect(() => {
    roleActionSequence.current += 1;
    roleActionInFlight.current = false;
    setRoleActionOutcome(null);
    return () => {
      roleActionSequence.current += 1;
      roleActionInFlight.current = false;
    };
  }, [app, firestore, adminUid]);

  async function changeRole(email: string, role: MemberRole) {
    if (
      !app
      || !firestore
      || !adminUid
      || currentStatus !== 'resolved'
      || currentRoleAction
      || roleActionInFlight.current
    ) return;

    roleActionSequence.current += 1;
    const actionId = roleActionSequence.current;
    const actionContext = { app, firestore, adminUid };
    const isCurrentAction = () => actionId === roleActionSequence.current
      && currentActionContextRef.current.app === actionContext.app
      && currentActionContextRef.current.firestore === actionContext.firestore
      && currentActionContextRef.current.adminUid === actionContext.adminUid;

    roleActionInFlight.current = true;
    setRoleActionOutcome({
      ...actionContext,
      status: 'pending',
      targetEmail: email,
    });

    try {
      await setMemberRole(app, email, role);
      if (!isCurrentAction()) return;
      await reload();
      if (!isCurrentAction()) return;
      setRoleActionOutcome(null);
    } catch {
      if (!isCurrentAction()) return;
      setRoleActionOutcome({
        ...actionContext,
        status: 'unknown',
        targetEmail: email,
      });
    } finally {
      if (isCurrentAction()) roleActionInFlight.current = false;
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (!q) return true;
      return m.email.toLowerCase().includes(q)
        || (m.fullName || '').toLowerCase().includes(q);
    });
  }, [members, filter, roleFilter]);

  const counts = useMemo(() => ({
    admin: members.filter((m) => m.role === 'admin').length,
    member: members.filter((m) => m.role === 'member').length,
    unverified: members.filter((m) => m.role === 'unverified').length,
    total: members.length,
  }), [members]);

  return (
    <>
      <SEO title="Admin — Website accounts" noindex />
      <div className="container mx-auto p-4 max-w-5xl">
        <Link to="/admin" className="text-sm text-blue-600 hover:underline">
          ← Admin home
        </Link>
        <h1 className="text-2xl font-bold mt-2">Website accounts</h1>

        {showAccountResults && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
              <div className="border rounded p-3 bg-purple-50">
                <div className="text-xs text-gray-600">Admin website access</div>
                <div className="text-xl font-bold">{counts.admin}</div>
              </div>
              <div className="border rounded p-3 bg-green-50">
                <div className="text-xs text-gray-600">Member website access</div>
                <div className="text-xl font-bold">{counts.member}</div>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="text-xs text-gray-600">Pending website verification</div>
                <div className="text-xl font-bold">{counts.unverified}</div>
              </div>
              <div className="border rounded p-3 bg-blue-50">
                <div className="text-xs text-gray-600">Total website accounts</div>
                <div className="text-xl font-bold">{counts.total}</div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap items-center my-3">
              <input
                className="border rounded px-3 py-2 flex-1 min-w-[200px]"
                placeholder="Search by name or email..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select
                className="border rounded px-3 py-2"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
              >
                <option value="all">All website roles</option>
                <option value="unverified">Unverified</option>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </>
        )}

        {currentStatus === 'loading' && !roleActionPending && <p>Loading...</p>}
        {currentStatus === 'unavailable' && (
          <p
            className="text-red-500 text-sm"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {LOAD_FAILURE}
          </p>
        )}
        {roleActionPending && (
          <p
            className="text-gray-600 text-sm"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            Updating website access...
          </p>
        )}
        {roleActionUnknown && (
          <p
            className="text-red-500 text-sm"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {ROLE_CHANGE_UNKNOWN}
          </p>
        )}

        {showAccountResults && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Website role</th>
                <th className="text-left p-2">Account created</th>
                <th className="text-left p-2">Email verified</th>
                <th className="text-right p-2">Change website role to...</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-gray-500">
                    No website accounts matched
                  </td>
                </tr>
              )}
              {filtered.map((m) => {
                const isSelf = user?.uid === m.uid;
                const busy = roleActionPending
                  && currentRoleAction.targetEmail === m.email;
                return (
                  <tr key={m.uid} className="border-b hover:bg-gray-50">
                    <td className="p-2">
                      {m.fullName || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-2">{m.email}</td>
                    <td className="p-2"><RolePill role={m.role} /></td>
                    <td className="p-2">{fmtDate(m.createdAt)}</td>
                    <td className="p-2">
                      {m.emailVerified
                        ? <span className="text-green-700 text-xs">yes</span>
                        : <span className="text-amber-700 text-xs">no</span>}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {ROLES.filter((r) => r !== m.role).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => changeRole(m.email, r)}
                          disabled={roleActionPending || (isSelf && r !== 'admin')}
                          className="text-blue-600 hover:underline mr-2 text-xs disabled:text-gray-400 disabled:no-underline"
                          title={isSelf && r !== 'admin' ? "Can't demote yourself" : ''}
                        >
                          {busy ? '...' : r}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function AdminMembers() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

export default AdminMembers;
