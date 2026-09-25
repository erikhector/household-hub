import Link from "next/link";
import type { Metadata } from "next";
import { BrandBadge } from "@/components/brand/brand-badge";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { STORAGE_INVENTORY } from "@/lib/cookie-inventory";

// Long-form legal prose, authored directly here in English rather than
// routed through src/lib/i18n/dictionaries — see the dictionary's `legal`
// section comment (src/lib/i18n/dictionaries/en.ts) for why. Content below
// is grounded in the actual data model (prisma/schema.prisma's User model),
// the actual email flow (src/lib/email.ts, Resend), and a repo-wide check
// that confirmed there are no analytics/tracking scripts anywhere in
// src/ — don't add either without updating this page. The cookie table in
// section 4 is generated from src/lib/cookie-inventory.ts.
export const metadata: Metadata = {
  title: "Privacy Policy — Squirrel",
};

const LAST_UPDATED = "September 25, 2026";

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
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
          <BrandBadge />
          {dict.auth.brand}
        </Link>

        <article className="flex flex-col gap-8">
          <header className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          </header>

          <Section title="1. Overview">
            <p>
              This policy explains what personal data Squirrel collects, why, and what (if
              anything) is shared with anyone else. Squirrel is a small household-management
              app — it isn&apos;t ad-supported, doesn&apos;t run analytics or tracking scripts of
              any kind (see &quot;Cookies and local storage&quot; and &quot;Third parties&quot; below for the
              small details), and doesn&apos;t sell or rent your data to anyone.
            </p>
          </Section>

          <Section title="2. Who this policy covers">
            <p>
              &quot;We&quot; means whoever operates the instance of Squirrel your account
              lives on — typically the person who set it up for you and your household, or the
              household owner who invited you. Squirrel isn&apos;t a large multi-tenant SaaS
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
              <li>Your Swish number, only if you add one in your Profile — it&apos;s shown to the members of your households so they can pay you back with Swish, and you can remove it there at any time;</li>
              <li>Which households you belong to and your role in each (owner or contributor).</li>
            </ul>
            <p>Beyond your account, Squirrel stores the content you and your household enter to use its features:</p>
            <ul className="list-disc pl-5">
              <li>Household-shared data: inventory items (including any product barcodes you link to them, so scanning one again finds the item), shopping lists, recipes, meal plans, and the household&apos;s shared budget categories and transactions — visible to every member of that household;</li>
              <li>Your personal budget: categories and transactions you track for yourself, visible only to you.</li>
            </ul>
            <p>Cookies and local storage are covered separately in the next section.</p>
          </Section>

          <Section title="4. Cookies and local storage" id="cookies">
            <p>
              Squirrel only stores small pieces of data on your device that are either strictly
              necessary to provide the features you use (staying signed in, keeping your
              household selected) or that remember a preference you chose yourself (language,
              theme, sidebar). None of them is used for advertising, analytics or tracking, and
              none is shared with a third party. Because of that, we don&apos;t ask for consent
              — we just tell you here. You can delete any of them through your browser&apos;s
              site-data settings; the only effect is that you&apos;ll be signed out and your
              preferences reset.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b text-foreground">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Purpose</th>
                    <th className="py-2 font-medium">Lasts</th>
                  </tr>
                </thead>
                <tbody>
                  {STORAGE_INVENTORY.map((entry) => (
                    <tr key={entry.name} className="border-b align-top last:border-b-0">
                      <td className="py-2 pr-3 font-mono">{entry.name}</td>
                      <td className="py-2 pr-3">
                        {entry.kind === "cookie" ? "Cookie" : "Local storage"},{" "}
                        {entry.category === "necessary" ? "necessary" : "preference"}
                      </td>
                      <td className="py-2 pr-3">{entry.purpose}</td>
                      <td className="py-2">{entry.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              On a secure (HTTPS) connection the sign-in cookies carry a browser-enforced prefix
              (<code>__Secure-</code> or <code>__Host-</code>) in front of the names above. If you
              turn on push notifications, your browser also keeps a service worker and a push
              subscription for this site; that is entirely opt-in through your browser&apos;s own
              permission prompt and can be revoked from the same place or from your profile page.
            </p>
          </Section>

          <Section title="5. Household invites">
            <p>
              When you invite someone to your household by email, we send that email via Resend,
              a transactional-email provider — see &quot;Third parties&quot; below. The
              invite&apos;s recipient email address is passed to Resend to deliver that one
              message and isn&apos;t otherwise stored in our database; the invite link itself
              (a random token with an expiry date) is stored so it can be looked up and redeemed
              when the recipient opens it.
            </p>
          </Section>

          <Section title="6. Third parties">
            <p>
              <strong>Resend</strong> receives personal data only to deliver account and
              household-invite emails (recipient email address, the inviting household&apos;s
              name, and the link). Resend processes that data on our behalf as a data processor,
              under its own privacy policy. If email delivery isn&apos;t configured on your
              instance, invites work purely through the on-screen shareable link and no email —
              or data — is sent anywhere.
            </p>
            <p>
              <strong>Open Food Facts</strong>, a free, open product database, is asked for a
              product&apos;s name and category when you scan a barcode Squirrel doesn&apos;t
              recognize yet. Only the barcode&apos;s digits are sent, from our server — the
              camera image is decoded on your device and never leaves it, and no account or
              household data goes with the request. A barcode you&apos;ve already linked to one of
              your items is looked up in your own inventory instead, and nothing is sent.
            </p>
            <p>
              <strong>Your browser&apos;s speech recognition</strong> is used when you tap the
              microphone button on a shopping list to add items by voice. Squirrel doesn&apos;t
              record or receive any audio — it only gets the text your browser hands back, which
              is then added exactly as if you&apos;d typed it. But some browsers don&apos;t
              recognize speech on your device: Chrome and Edge, for example, send the recording
              to Google&apos;s or Microsoft&apos;s servers, and Safari may send it to Apple,
              under that company&apos;s own privacy policy. Nothing is recorded until you tap the
              button, listening stops after one phrase, and if you&apos;d rather not use it, typing
              works exactly the same. Browsers without speech recognition don&apos;t show the
              button at all.
            </p>
            <p>
              <strong>Gemini</strong> (Google) and <strong>Anthropic</strong> are used by three
              optional AI features, and only when whoever operates your instance has configured
              an API key for one of them — with no key configured, none of this ever runs.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>AI shelf scan</strong> and <strong>AI receipt scan</strong> only run when
                you start them. Each uploads the photo you take (of a shelf, fridge or cupboard,
                or of a paper receipt) so a vision model can read it. In shelf scan&apos;s
                &quot;Take stock&quot; mode, the names of your household&apos;s current inventory
                items (up to 300) are sent along with the photo so the model can match what it
                sees to them. The photo itself is never saved in our database — only the rows you
                review and confirm afterwards are.
              </li>
              <li>
                <strong>AI auto-categorization</strong> runs automatically, in the background,
                when you add a new item whose name neither the built-in dictionary nor your
                household&apos;s earlier items recognize. Only those item names are sent — never
                quantities, prices, or any other household or account data — and the answer is
                used solely to fill in the item&apos;s category. The item is saved right away as
                &quot;Uncategorized&quot; either way, and a category you&apos;ve already set
                yourself is never overwritten.
              </li>
            </ul>
            <p>
              What Google and Anthropic do with data sent to their APIs is governed by their own
              API terms and privacy policies.
            </p>
            <p>
              <strong>Sentry</strong> (error reporting) is optional and only active if whoever
              operates your instance has switched it on. When active, if the app crashes or hits
              an unexpected error, technical details about that error (the error message and
              stack trace, the page address, your browser and device type, and possibly your IP
              address) are sent to Sentry so the problem can be fixed. Sentry acts as a data
              processor on our behalf. It is not configured to record sessions, track your usage
              or set cookies, and we don&apos;t send your inventory, shopping list, meal plan or
              budget contents to it on purpose. If your instance doesn&apos;t use it, nothing is
              sent.
            </p>
            <p>
              We don&apos;t use any analytics or advertising service. There is no tracking pixel
              and no ad network. Apart from the barcode digits sent to Open Food Facts, the
              optional Gemini/Anthropic AI features, and the speech your own browser may send its
              vendor when you add items by voice, all described above, no third party receives
              your inventory, shopping list, meal plan, or budget data.
            </p>
          </Section>

          <Section title="7. Legal basis for processing (EU/EEA users)">
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

          <Section title="8. How long we keep data">
            <p>
              Account and household data is kept for as long as the account or household exists.
              A household owner can permanently delete their household at any time from that
              household&apos;s settings (&quot;Danger zone&quot;) — this immediately and
              irreversibly deletes all of that household&apos;s inventory, shopping lists, recipes,
              meal plans, and shared budget data for every member. Leaving a household removes
              your membership and access to its data, but doesn&apos;t delete your account.
            </p>
          </Section>

          <Section title="9. Your rights and how to exercise them">
            <p>
              Depending on where you live, you may have rights to access, correct, export, or
              delete your personal data, and to object to or restrict certain processing — for
              EU/EEA and Swedish users, these come from the GDPR.
            </p>
            <p>
              You can exercise most of these rights yourself, without contacting anyone: use
              &quot;Export my data&quot; in your Profile to download a copy of your personal
              data, or &quot;Delete account&quot; there to permanently delete your account. You
              can also delete your own content (for example, individual inventory items,
              shopping lists, or budget entries) yourself at any time through the app. For
              anything those self-service tools don&apos;t cover, contact the household owner
              who invited you, or whoever operates your instance of Squirrel.
            </p>
          </Section>

          <Section title="10. Children">
            <p>
              Squirrel isn&apos;t directed at children and isn&apos;t knowingly used to
              collect personal data from anyone below the age required to consent to data
              processing under their local law (13 in most contexts, 16 under the GDPR unless
              their country sets it lower). If you believe a child has created an account, contact
              your instance&apos;s operator to have it removed.
            </p>
          </Section>

          <Section title="11. Security">
            <p>
              Passwords are hashed before storage and are never visible to anyone, including
              whoever operates your instance. Login and signup attempts are rate-limited to slow
              down automated guessing. No system is perfectly secure, so we can&apos;t guarantee
              absolute security of information you send us.
            </p>
          </Section>

          <Section title="12. Changes to this policy">
            <p>
              If this policy changes, we&apos;ll update the &quot;Last updated&quot; date above.
              Material changes — for example, if a new third-party service is ever added — will
              be reflected here before they take effect.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              For any question about this policy or your data, contact the household owner who
              invited you, or the person who operates your instance of Squirrel. See also
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
