import React, { useEffect, useMemo, useState } from 'react';
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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | MemberRole>('all');

  async function reload() {
    if (!services) return;
    setLoading(true);
    try {
      const all = await listAllMembers(services.firebaseResources.firestore);
      setMembers(all);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isReady || !services) return;
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, isReady]);

  async function changeRole(email: string, role: MemberRole) {
    if (!services) return;
    setUpdating(email);
    setError(null);
    try {
      await setMemberRole(services.firebaseResources.app, email, role);
      await reload();
    } catch (err: any) {
      setError(err?.message || 'Role update failed');
    } finally {
      setUpdating(null);
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
      <SEO title="Admin — Members" noindex />
      <div className="container mx-auto p-4 max-w-5xl">
        <Link to="/admin" className="text-sm text-blue-600 hover:underline">
          ← Admin home
        </Link>
        <h1 className="text-2xl font-bold mt-2">Members</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
          <div className="border rounded p-3 bg-purple-50">
            <div className="text-xs text-gray-600">Admins</div>
            <div className="text-xl font-bold">{counts.admin}</div>
          </div>
          <div className="border rounded p-3 bg-green-50">
            <div className="text-xs text-gray-600">Members</div>
            <div className="text-xl font-bold">{counts.member}</div>
          </div>
          <div className="border rounded p-3 bg-gray-50">
            <div className="text-xs text-gray-600">Pending verification</div>
            <div className="text-xl font-bold">{counts.unverified}</div>
          </div>
          <div className="border rounded p-3 bg-blue-50">
            <div className="text-xs text-gray-600">Total</div>
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
            <option value="all">All roles</option>
            <option value="unverified">Unverified</option>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {loading && <p>Loading...</p>}
        {error && <p className="text-red-500 text-sm">{error}</p>}

        {!loading && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Role</th>
                <th className="text-left p-2">Joined</th>
                <th className="text-left p-2">Email verified</th>
                <th className="text-right p-2">Change role to...</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-gray-500">
                    No members matched
                  </td>
                </tr>
              )}
              {filtered.map((m) => {
                const isSelf = user?.uid === m.uid;
                const busy = updating === m.email;
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
                          disabled={busy || (isSelf && r !== 'admin')}
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
