-- has_password(): έχει ο ΤΡΕΧΩΝ χρήστης κωδικό πρόσβασης; true/false και τίποτα άλλο.
-- Χρειάζεται γιατί το Supabase δεν το δείχνει στην εφαρμογή: λογαριασμός Google που όρισε κωδικό με
-- «Ξέχασα τον κωδικό» μένει providers = ['google']. Η εφαρμογή το ρωτά όταν χρειάζεται (αλλαγή κωδικού, διαγραφή).
--
-- Ασφάλεια:
-- - Καμία παράμετρος: κοιτάζει ΜΟΝΟ τη γραμμή auth.uid() (από το JWT της αίτησης). Κανείς δεν ρωτά για άλλον.
-- - security definer (το auth.users δεν διαβάζεται από authenticated) με κενό search_path: μόνο πλήρη ονόματα.
-- - Επιστρέφει boolean· ποτέ το hash, το email ή άλλο στοιχείο. Χωρίς σύνδεση (auth.uid() null) → false.
-- - Εκτέλεση μόνο από authenticated (όχι anon, όχι public).
create or replace function public.has_password()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
       from auth.users u
      where u.id = auth.uid()),
    false)
$$;

revoke all on function public.has_password() from public;
revoke all on function public.has_password() from anon;
grant execute on function public.has_password() to authenticated;
