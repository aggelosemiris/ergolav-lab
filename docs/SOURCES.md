# Πηγές για ισχυρισμούς που βλέπει ο χρήστης

Ημερομηνία ελέγχου: **29/9/2026**. Όροι και τιμές αλλάζουν — να ξαναελέγχονται πριν από κάθε έκδοση προς πελάτες.

«Τρόπος ελέγχου»: **σελίδα** = διαβάστηκε η ίδια η σελίδα · **αναζήτηση** = το περιεχόμενο επιβεβαιώθηκε μέσω
αποτελεσμάτων αναζήτησης γιατί η σελίδα δεν ήταν προσβάσιμη από το περιβάλλον ελέγχου (να ανοιχτεί από άνθρωπο
για τελική επιβεβαίωση).

| Ισχυρισμός στην εφαρμογή | Πηγή | Τρόπος ελέγχου |
|---|---|---|
| Google Gemini έχει δωρεάν επίπεδο με όρια· στο δωρεάν επίπεδο η Google χρησιμοποιεί περιεχόμενο και απαντήσεις για βελτίωση προϊόντων, ανθρώπινοι reviewers μπορεί να τα διαβάσουν, και συστήνει να μη στέλνονται προσωπικά/ευαίσθητα στοιχεία· στο πληρωμένο επίπεδο όχι | [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) | αναζήτηση |
| Anthropic API: προπληρωμένα credits, χωρίς μηνιαία συνδρομή | [How do I pay for my Claude API usage?](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage) | αναζήτηση |
| Anthropic: δεν εκπαιδεύει μοντέλα με δεδομένα από εμπορικά προϊόντα (API), εκτός αν ο πελάτης το επιλέξει/δώσει feedback | [Is my data used for model training?](https://support.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training) · [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | αναζήτηση |
| Claude Sonnet 5.5: $2 / $10 ανά 1M tokens (input/output)· Opus 5.5: $4 / $20 → Sonnet ≈ μισό κόστος | [Pricing — Claude Platform Docs](https://platform.claude.com/docs/en/about-claude/pricing) · [Claude Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5) | αναζήτηση |
| Παράμετροι `output_config.effort`, `fallbacks: "default"`, beta `server-side-fallback-2026-07-01` υπάρχουν στο API | Τύποι του `@anthropic-ai/sdk` 0.129.0 (`resources/beta/messages/messages.d.ts`) — type-check του ακριβούς αιτήματος | type-check (όχι ζωντανή κλήση) |
| Μειωμένοι συντελεστές ΦΠΑ (−30%) σε Λέρο, Λέσβο, Κω, Σάμο, Χίο· επέκταση από 1/1/2026 σε νησιά Β. Αιγαίου, Σαμοθράκη, Δωδεκανήσου έως 20.000 κατοίκους, για αγαθά/υπηρεσίες που πληρούν τις προϋποθέσεις (άρθρο 26 Κώδικα ΦΠΑ) | [taxheaven — τροπολογία](https://www.taxheaven.gr/news/54964/meiwsh-syntelestwn-fpa-gia-lero-lesbo-kw-samo-kai-xio-katateohke-h-tropologia) · [ΤΑ ΝΕΑ 1/1/2026](https://www.tanea.gr/2026/01/01/economy/meiosi-fpa-poia-nisia-kerdizoun-apo-to-neo-metro-kai-poia-proionta-kai-ypiresies-epireazontai/) · [Business Daily](https://www.businessdaily.gr/oikonomia/178725_meiosi-fpa-kata-30-se-mikra-nisia-boreioy-aigaioy-samothrakis-kai-dodekanisoy) | αναζήτηση (δευτερογενείς πηγές — η πρωτογενής είναι ΦΕΚ/ΑΑΔΕ) |
| Gemini: τα όρια αιτημάτων ισχύουν **ανά Google Cloud project**, όχι ανά key· ~10 αιτήματα/λεπτό στο δωρεάν επίπεδο για μοντέλα Flash (τιμές ενδεικτικές, αλλάζουν) | [Gemini API rate limits (Google)](https://ai.google.dev/gemini-api/docs/rate-limits) · δευτερογενείς: [fast.io](https://fast.io/resources/gemini-api-rate-limit/), [aipromptshub](https://aipromptshub.co/blog/gemini-api-free-tier-rate-limits) | αναζήτηση (η σελίδα της Google δεν διαβάστηκε απευθείας) |
| GitHub Pages: soft όριο 100 GB/μήνα εύρους ζώνης, 1 GB μέγεθος site, 10 builds/ώρα (δεν ισχύει για custom Actions workflow)· **δεν επιτρέπεται** ως δωρεάν hosting για επιχείρηση ή website που παρέχει εμπορικό λογισμικό ως υπηρεσία (SaaS) | [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) | αναζήτηση (αποσπάσματα της επίσημης σελίδας) |

## Τι ΔΕΝ ισχυρίζεται η εφαρμογή

- **Ποιος συντελεστής ΦΠΑ ισχύει** για μια δουλειά. Η εφαρμογή απλώς εφαρμόζει τον συντελεστή που επιλέγει ο
  τεχνίτης· η ευθύνη είναι δική του / του λογιστή του. Οι συντελεστές 13% και 6% για εργασίες ανακαίνισης
  **δεν** έχουν ελεγχθεί — υπάρχουν στη λίστα μόνο ως αριθμοί, χωρίς πρόταση πότε ισχύουν.
- Ότι η κάλυψη στη φωτογραφία βρίσκει μόνη της ονόματα/τηλέφωνα. Η κάλυψη είναι **χειροκίνητη**.
