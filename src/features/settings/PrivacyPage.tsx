import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toJSON } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { downloadFile, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useMe } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/layout-bits';

export default function PrivacyPage() {
  useDocumentTitle('Privacy');
  const { user, signOut } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [exporting, setExporting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);

  if (me.isLoading || !me.data) return <Skeleton className="h-96 rounded-2xl" />;

  const exportAll = async () => {
    setExporting(true);
    try {
      const data = unwrap(await supabase.rpc('export_my_data'));
      downloadFile(`owenil-my-data-${todayISO()}.json`, toJSON(data), 'application/json');
      toast.success('Your data export is downloading');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      // Remove receipt images from private storage first (database rows are anonymised server-side).
      const { data: files } = await supabase.storage.from('receipts').list(user!.id, { limit: 1000 });
      if (files?.length) await supabase.storage.from('receipts').remove(files.map((f) => `${user!.id}/${f.name}`));
      unwrap(await supabase.rpc('delete_my_account', { p_confirmation: confirm }));
      await signOut();
      toast.success('Your account was deleted');
      navigate('/', { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Privacy" description="Control who can find you and what happens to your data." />
      <Card className="divide-y divide-border">
        <label className="flex items-center justify-between gap-4 p-5">
          <span>
            <span className="block text-sm font-medium">Let people find me by email</span>
            <span className="block text-xs text-fg-muted">When on, a friend invitation sent to your email also appears inside Owenil. Inviters are never told whether an account exists.</span>
          </span>
          <Switch
            checked={me.data.preferences.discoverable_by_email}
            aria-label="Let people find me by email"
            onCheckedChange={async (v) => {
              const { error } = await supabase.from('user_preferences').update({ discoverable_by_email: v }).eq('user_id', user!.id);
              if (error) toast.error(errorMessage(error));
              else void qc.invalidateQueries({ queryKey: qk.me });
            }}
          />
        </label>
        <div className="p-5 text-sm text-fg-muted">
          <p className="font-medium text-fg">What others can see</p>
          <p className="mt-1">Your display name and avatar colour are visible to people you share a group, friendship or expense with. Your email address is never shown to other users. If you add a UPI ID, only current friends and people in your active groups can see it. Receipts are private to the people on that expense.</p>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="font-medium">Download all my data</p>
          <p className="text-sm text-fg-muted">A complete JSON copy of your profile, groups, expenses, repayments, ledger lines and settings. Free for everyone.</p>
        </div>
        <Button variant="outline" onClick={exportAll} loading={exporting}><Download /> Export JSON</Button>
      </Card>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="font-medium">Sign out everywhere</p>
          <p className="text-sm text-fg-muted">Ends your sessions on every device and browser.</p>
        </div>
        <Button variant="outline" onClick={async () => { await signOut('global'); navigate('/login'); }}><LogOut /> Sign out all devices</Button>
      </Card>

      <Card className="border-negative/40 p-5">
        <p className="flex items-center gap-2 font-medium text-negative"><AlertTriangle className="size-4" /> Delete account</p>
        <p className="mt-1 text-sm text-fg-muted">
          Settle all your balances first. Your profile, preferences, budgets, rates, notifications and receipt images are deleted. Shared expenses stay in your friends’ history under “Deleted user” so their balances remain correct.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setDeleteOpen(true)}><Trash2 /> Delete my account</Button>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete your Owenil account?" description="This can’t be undone."
        footer={<><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE'} loading={deleting} onClick={deleteAccount}>Delete forever</Button></>}>
        <Field label={<>Type <strong>DELETE</strong> to confirm</>} htmlFor="del-confirm">
          <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </Field>
      </Dialog>
    </div>
  );
}
