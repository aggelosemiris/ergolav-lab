-- ergolav — bot_metrics: αυστηρό σχήμα για τις ανώνυμες μετρήσεις (αντικαθιστά το φίλτρο της 20261118).
-- Τρέχει μία φορά στο SQL editor του Supabase, ΜΕΤΑ την 20261118 (όπως τα προηγούμενα). Ξανατρέξιμο.
--
-- Λόγος αλλαγής (ασφάλεια):
-- Το παλιό check «not (event ?| array['text','name','client','user','email','phone'])» έφραζε ΜΟΝΟ top-level
-- keys με συγκεκριμένα ονόματα. Ένας συνδεδεμένος χρήστης, με απευθείας insert (όχι από την εφαρμογή), μπορούσε:
--   • να βάλει προσωπικά δεδομένα σε ΕΜΦΩΛΕΥΜΕΝΑ ή αλλιώς-ονομασμένα keys (π.χ. {"a":{"email":"…"}}),
--   • να γεμίσει τον πίνακα με αυθαίρετο περιεχόμενο.
-- Τώρα το event πρέπει να είναι ΑΚΡΙΒΩΣ όπως το φτιάχνει η allaxe-store.track(): ΕΠΙΠΕΔΟ αντικείμενο με
-- t (αριθμός) και ΜΟΝΟ τα κλειδιά ev/step/choice/material/analysis/outcome/engine, καθένα σύντομο string.
-- Έτσι δεν περνά τίποτα εμφωλευμένο, κανένα άγνωστο key και καμία υπερμεγέθη τιμή — ό,τι κι αν στείλει ο client.
--
-- Υπόλοιπο (όγκος): η εισαγωγή απαιτεί συνδεδεμένο λογαριασμό και κάθε γραμμή είναι <= 600 bytes με έως 8 μικρά
-- πεδία. Ο πίνακας δεν διαβάζεται από την εφαρμογή (μόνο εμείς, από το SQL editor). Αν χρειαστεί σκληρότερο όριο
-- ρυθμού, η εισαγωγή μετακινείται πίσω από security-definer συνάρτηση με μετρητή (όπως η bump_missing_item).

drop policy if exists "bot_metrics: insert" on public.bot_metrics;
create policy "bot_metrics: insert" on public.bot_metrics for insert to authenticated
  with check (
    jsonb_typeof(event) = 'object'
    and pg_column_size(event) <= 600
    and jsonb_typeof(event -> 't') = 'number'
    and (
      select coalesce(bool_and(
        k in ('t', 'ev', 'step', 'choice', 'material', 'analysis', 'outcome', 'engine')
        and case
          when k = 't' then jsonb_typeof(v) = 'number'
          else jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 120
        end
      ), false)
      from jsonb_each(event) as e(k, v)
    )
  );
