---
name: md-writing
description: 'Use when writing any markdown file — plans, notes, tickets, READMEs, docs, briefs, summaries, design memos, retrospectives, or any prose document. Load before producing or editing .md / .mdx files so the output is scannable, checkpoint-friendly, and follows the repo''s writing conventions (short paragraphs, clear headings, code-friendly callouts).'
---
# Writing Markdown Files

Whenever you write a markdown file — plans, notes, tickets, READMEs, docs, briefs, summaries, design memos, retrospectives, anything — follow the rules below so the human reading it can checkpoint, scan, and stop cleanly without being asked to absorb a 14-line wall.
 
These rules are **structural, not numeric**. They describe patterns the writer can detect in text they just produced; nothing here asks the model to count words, characters, or sentences.
 
## One assertion per sentence
 
Each sentence carries **one claim**. If a sentence does any of the following, the joint inside it is a sentence break in disguise — split there:
 
- **Semicolon joining two clauses that each stand on their own.** "X happens; Y also happens" is two sentences.
- **Em-dash introducing a new full assertion** (not a brief appositive). "X — and then Y, and Z, and..." is a paragraph wearing a hat.
- **A coordinating conjunction joining two independent claims** — `and`, `plus`, `while`, `so`, `but` between two things that each have a subject and a verb.
- **Inline enumeration** like "(a)... (b)... (c)..." or comma-separated claims (`X, Y, Z, and W` where each item is its own assertion). That's a bullet list trying to escape prose — convert it to a list, or to one-claim sentences.
- **Multiple parentheticals.** Two or more parenthetical asides in one sentence means the asides want to be their own sentences (or removed).
 
The test: can you put a full stop somewhere mid-sentence and have both halves stand on their own legs? If yes, you should have.
 
## One conceptual move per paragraph
 
Each paragraph makes **one move**. Common moves include *current state*, *what's changing*, *mechanics*, *motivation*, *constraint*, *non-goal*, *caveat*, *example*, *failure mode* — the specific set depends on the document type. When the topic shifts from one move to another, the paragraph ends — no exceptions, no transitions.
 
Three tests, all of which the writer can apply to the paragraph they just wrote:
 
- **Stop-cleanly test.** If a reader stops at the paragraph break, do they leave with **one** complete takeaway? Two takeaways = two paragraphs.
- **Glue-marathon test.** Is the paragraph held together primarily by `;`, `—`, and `and` / `plus` / `while`? Each glue point is a paragraph break in disguise — cut there and see if each side stands alone.
- **List-in-disguise test.** Does the paragraph read like "X, Y, plus Z; also W, and additionally V"? That's a bullet list. Either render it as a list, or break into one-claim sentences.
 
## Decreasing length never means dropping information
 
If a paragraph is too long, restructure it into more paragraphs and shorter sentences. **Do not** condense by deleting facts, merging clauses with semicolons, or replacing detail with vague summary. The information stays; only the shape changes.
 
## What this looks like in practice
 
A bad paragraph from a process-change brief:
 
> Today, our onboarding process sends new hires a welcome email on day one with login credentials and links to all internal tools; HR then schedules a 30-minute orientation call within the first week, and the manager separately runs a 1:1 to assign initial work — the new plan consolidates everything into a single structured onboarding portal hosted at onboarding.company.com that is provisioned automatically when the offer is accepted, and the portal pulls the new hire's role from the HRIS, generates a personalized checklist, surfaces day-1 / week-1 / month-1 milestones, links to the orientation call (auto-scheduled by the portal), and notifies the manager when the new hire completes each milestone.
 
That paragraph fuses *current state*, *what's changing*, and *mechanics*, glued together with semicolons, em-dashes, and commas. The fix is to find the conceptual seams and break:
 
> **Today:** new hires get a welcome email on day one with login credentials and links to internal tools. HR schedules a 30-minute orientation call in the first week. The manager runs a separate 1:1 to assign initial work.
>
> **What changes:** everything consolidates into a single onboarding portal at `onboarding.company.com`, auto-provisioned when the offer is accepted. The portal pulls the new hire's role from the HRIS and generates a personalized checklist with day-1, week-1, and month-1 milestones.
>
> **At each milestone:** the portal auto-schedules the orientation call, surfaces the next set of tasks, and notifies the manager when the new hire marks a milestone complete.
 
Same information. Three checkpoints instead of zero. Each paragraph makes one move; each sentence makes one claim.
