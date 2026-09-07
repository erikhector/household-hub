import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// Long-form legal prose, authored directly here in English rather than
// routed through src/lib/i18n/dictionaries — see the dictionary's `legal`
// section comment (src/lib/i18n/dictionaries/en.ts) for why. Content below
// is grounded in the actual data model (prisma/schema.prisma's User model),
// the actual email flow (src/lib/email.ts, Resend), and a repo-wide check
// that confirmed there are no analytics/tracking scripts anywhere in
// src/ — don't add either without updating this page.
export const metadata: Metadata = {
  title: "Privacy Policy — Household Hub",
};

const LAST_UPDATED = "September 7, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default async function PrivacyPage() {
  const dict = await getDictionary();

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-12">
      <div className="flex w-full max-w-3xl flex-col gap-10">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="size-4" />
          </span>
          {dict.auth.brand}
        </Link>

        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          </header>

          <Section title="1. Overview">
            <p>
              This policy explains what personal data Household Hub collects, why, and what (if
              anything) is shared with anyone else. Household Hub is a small household-management
              app — it isn&apos;t ad-supported, doesn&apos;t run analytics or tracking scripts of
              any kind, and doesn&apos;t sell or rent your data to anyone.
            </p>
          </Section>

          <Section title="2. Who this policy covers">
            <p>
              &quot;We&quot; means whoever operates the instance of Household Hub your account
              lives on — typically the person who set it up for you and your household, or the
              household owner who invited you. Household Hub isn&apos;t a large multi-tenant SaaS
              company with a dedicated privacy team; it&apos;s a self-run app, so for anything
              this policy says to contact &quot;us&quot; about, that means contacting them.
            </p>
          </Section>

          <Section title="3. What we collect">
            <p>When you create an account, we store:</p>
            <ul className="list-disc pl-5">
              <li>Your email address (used to log in and, if you&apos;re invited to or invite others to a household, to send invite emails);</li>
              <li>Your password — never in plain text. It&apos;s hashed with bcrypt before storage, so we can verify it at login but can&apos;t see or recover the original password;</li>
              <li>Your display name;</li>
              <li>Which households you belong to and your role in each (owner or contributor).</li>
            </ul>
            <p>Beyond your account, Household Hub stores the content you and your household enter to use its features:</p>
            <ul className="list-disc pl-5">
              <li>Household-shared data: inventory items, shopping lists, recipes, meal plans, and the household&apos;s shared budget categories and transactions — visible to every member of that household;</li>
              <li>Your personal budget: categories and transactions you track for yourself, visible only to you.</li>
            </ul>
            <p>We also set a small number of functional cookies: one to keep you signed in, one to remember which household you last had active, one to remember your sidebar preference, and one to remember your chosen language (English or Swedish). None of these are advertising or tracking cookies, and none are shared with any third party.</p>
          </Section>

          <Section title="4. Household invites">
            <p>
              When you invite someone to your household by email, we send that email via Resend,
              a transactional-email provider — see &quot;Third parties&quot; below. The
              invite&apos;s recipient email address is passed to Resend to deliver that one
              message and isn&apos;t otherwise stored in our database; the invite link itself
              (a random token with an expiry date) is stored so it can be looked up and redeemed
              when the recipient opens it.
            </p>
          </Section>

          <Section title="5. Third parties">
            <p>
              <strong>Resend</strong> is the only third-party service Household Hub sends any
              personal data to, and only for delivering household-invite emails (recipient email
              address, the inviting household&apos;s name, and the invite link). Resend processes
              that data on our behalf as a data processor, under its own privacy policy. If email
              delivery isn&apos;t configured on your instance, invites work purely through the
              on-screen shareable link and no email — or data — is sent anywhere.
            </p>
            <p>
              We don&apos;t use any analytics, advertising, or crash-reporting service that
              collects data about you or your usage. There is no tracking pixel, no ad network,
              and no third party that receives your inventory, shopping list, meal plan, or
              budget data.
            </p>
          </Section>

          <Section title="6. Legal basis for processing (EU/EEA users)">
            <p>
              If you&apos;re in the EU/EEA (including Sweden), our legal basis for processing your
              account and household data is performance of the contract formed by these terms —
              we need it to provide the features you&apos;ve signed up to use. Rate-limiting login
              and signup attempts (to slow down password-guessing) relies on our legitimate
              interest in keeping the service secure; that rate-limit data lives only in server
              memory, is keyed by the email address being attempted, and clears automatically —
              it&apos;s never written to the database or kept after a restart.
            </p>
          </Section>

          <Section title="7. How long we keep data">
            <p>
              Account and household data is kept for as long as the account or household exists.
              A household owner can permanently delete their household at any time from that
              household&apos;s settings (&quot;Danger zone&quot;) — this immediately and
              irreversibly deletes all of that household&apos;s inventory, shopping lists, recipes,
              meal plans, and shared budget data for every member. Leaving a household removes
              your membership and access to its data, but doesn&apos;t delete your account.
            </p>
          </Section>

          <Section title="8. Your rights and how to exercise them">
            <p>
              Depending on where you live, you may have rights to access, correct, export, or
              delete your personal data, and to object to or restrict certain processing — for
              EU/EEA and Swedish users, these come from the GDPR.
            </p>
            <p>
              Household Hub doesn&apos;t yet have a self-service &quot;export my data&quot; or
              &quot;delete my account&quot; button built into the app. Until it does, you can
              exercise any of these rights by contacting the household owner who invited you, or
              whoever operates your instance of Household Hub — they can look up, correct, export,
              or delete your account data directly. You can already delete your own content (for
              example, individual inventory items, shopping lists, or budget entries) yourself at
              any time through the app.
            </p>
          </Section>

          <Section title="9. Children">
            <p>
              Household Hub isn&apos;t directed at children and isn&apos;t knowingly used to
              collect personal data from anyone below the age required to consent to data
              processing under their local law (13 in most contexts, 16 under the GDPR unless
              their country sets it lower). If you believe a child has created an account, contact
              your instance&apos;s operator to have it removed.
            </p>
          </Section>

          <Section title="10. Security">
            <p>
              Passwords are hashed before storage and are never visible to anyone, including
              whoever operates your instance. Login and signup attempts are rate-limited to slow
              down automated guessing. No system is perfectly secure, so we can&apos;t guarantee
              absolute security of information you send us.
            </p>
          </Section>

          <Section title="11. Changes to this policy">
            <p>
              If this policy changes, we&apos;ll update the &quot;Last updated&quot; date above.
              Material changes — for example, if a new third-party service is ever added — will
              be reflected here before they take effect.
            </p>
          </Section>

          <Section title="12. Contact">
            <p>
              For any question about this policy or your data, contact the household owner who
              invited you, or the person who operates your instance of Household Hub. See also
              our{" "}
              <Link href="/terms" className="text-primary underline underline-offset-4">
                Terms of Service
              </Link>
              .
            </p>
          </Section>
        </article>
      </div>
    </div>
  );
}
