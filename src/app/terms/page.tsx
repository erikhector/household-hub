import Link from "next/link";
import type { Metadata } from "next";
import { BrandBadge } from "@/components/brand/brand-badge";
import {
  LegalJumpList,
  LegalSection as Section,
  type LegalJumpItem,
} from "@/components/legal/legal-page";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { titleOnlyMetadata } from "@/lib/page-metadata";
import { TermsSv } from "./terms-sv";

// Long-form legal prose, authored directly here in English (and in
// ./terms-sv.tsx in Swedish) rather than routed through
// src/lib/i18n/dictionaries — see the dictionary's `legal` section comment
// for why. UX-66: the page serves the visitor's language (locale cookie,
// like the rest of the app) and marks the article with the matching `lang`.
// The Swedish text is a faithful translation of this one: change both
// together, and keep the section ids identical.
export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return titleOnlyMetadata(dict.meta.termsTitle);
}

const LAST_UPDATED = "September 7, 2026";

const SECTIONS: LegalJumpItem[] = [
  { id: "what", title: "1. What Squirrel is" },
  { id: "account", title: "2. Your account" },
  { id: "households", title: "3. Households are shared spaces" },
  { id: "acceptable-use", title: "4. Acceptable use" },
  { id: "content", title: "5. Your content" },
  { id: "third-parties", title: "6. Third-party services" },
  { id: "warranty", title: "7. No warranty" },
  { id: "liability", title: "8. Limitation of liability" },
  { id: "changes", title: "9. Changes to these terms" },
  { id: "ending", title: "10. Ending your account" },
  { id: "contact", title: "11. Contact" },
];

export default async function TermsPage() {
  const dict = await getDictionary();
  const isSv = (await getLocale()) === "sv";

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-12">
      <div className="flex w-full max-w-3xl flex-col gap-10">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 font-heading text-lg font-bold tracking-tight"
        >
          <BrandBadge />
          {dict.auth.brand}
        </Link>

        {isSv ? (
          <TermsSv jumpListLabel={dict.legal.jumpListLabel} />
        ) : (
        <article lang="en" className="flex flex-col gap-8">
          <header className="flex flex-col gap-1">
            <h1 className="font-heading text-3xl font-bold tracking-tight">Terms of service</h1>
            <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          </header>

          <LegalJumpList label={dict.legal.jumpListLabel} items={SECTIONS} />

          <Section title="1. What Squirrel is" id="what">
            <p>
              Squirrel is a household-management tool for tracking pantry inventory,
              building shopping lists, planning meals, and keeping a shared or personal budget.
              You create an account, set up a household (or join one someone else already
              created, via an invite link), and everyone in that household can see and manage
              the household&apos;s shared data together.
            </p>
          </Section>

          <Section title="2. Your account" id="account">
            <p>
              You need an account (email address, password, and a display name) to use
              Squirrel. You&apos;re responsible for keeping your password confidential and
              for all activity under your account. Let us know if you believe your account has
              been accessed without your permission.
            </p>
            <p>
              You must provide accurate information when creating an account, and you must be
              old enough, under the law of your country, to enter into these terms yourself.
            </p>
          </Section>

          <Section title="3. Households are shared spaces" id="households">
            <p>
              A household is a shared workspace: its inventory, shopping lists, recipes, meal
              plans, and shared budget are visible to and editable by every member you or another
              member invites. Only invite people you actually want to share this data with.
            </p>
            <p>
              Each household has one owner (the person who created it, unless ownership is later
              transferred to another member) and any number of contributors. The owner can remove
              members and can permanently delete the household — which deletes all of its shared
              data for every member, with no way to undo it. Contributors can leave a household at
              any time from their own account.
            </p>
            <p>
              Your personal budget (as distinct from a household&apos;s shared budget) is scoped
              to your own account only — other household members can&apos;t see it.
            </p>
          </Section>

          <Section title="4. Acceptable use" id="acceptable-use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-5">
              <li>Use Squirrel for anything unlawful, or to store or share content you don&apos;t have the right to store or share;</li>
              <li>Try to access another household&apos;s data without a valid invite;</li>
              <li>Attempt to circumvent rate limits, probe for vulnerabilities, or otherwise interfere with the service&apos;s normal operation;</li>
              <li>Use the invite system to send unsolicited email to people who haven&apos;t asked to join your household.</li>
            </ul>
          </Section>

          <Section title="5. Your content" id="content">
            <p>
              You retain ownership of the content you and your household enter — inventory
              items, shopping lists, recipes, meal plans, budget entries, and the like. You grant
              us only the limited right to store, process, and display that content back to you
              and your household members, solely to operate the service for you.
            </p>
          </Section>

          <Section title="6. Third-party services" id="third-parties">
            <p>
              When you send a household invite by email, we use Resend, a transactional-email
              provider, to deliver that message. See our{" "}
              <Link href="/privacy" className="text-primary underline underline-offset-4">
                Privacy policy
              </Link>{" "}
              for what that involves. We don&apos;t use any advertising or analytics services.
            </p>
          </Section>

          <Section title="7. No warranty" id="warranty">
            <p>
              Squirrel is a small, personally-run application, provided &quot;as is&quot;
              without warranties of any kind, express or implied. We don&apos;t guarantee the
              service will be uninterrupted, error-free, or available at all times. You&apos;re
              responsible for keeping your own copies of anything you can&apos;t afford to lose —
              for example, by exporting budget data where the app supports it.
            </p>
            <p>
              Nothing in these terms limits any statutory rights you have as a consumer that
              can&apos;t be excluded under the law of your country of residence, including under
              EU or Swedish consumer-protection law where applicable.
            </p>
          </Section>

          <Section title="8. Limitation of liability" id="liability">
            <p>
              To the fullest extent permitted by law, Squirrel and whoever operates this
              instance of it are not liable for any indirect, incidental, or consequential
              damages arising from your use of the service, including loss of data.
            </p>
          </Section>

          <Section title="9. Changes to these terms" id="changes">
            <p>
              We may update these terms as the service changes. If we make a material change,
              we&apos;ll update the &quot;Last updated&quot; date above. Continuing to use
              Squirrel after a change means you accept the updated terms.
            </p>
          </Section>

          <Section title="10. Ending your account" id="ending">
            <p>
              You can leave any household you belong to at any time. A household owner can
              delete their household at any time from that household&apos;s settings, which is
              permanent. To close your account entirely, use &quot;Delete account&quot; in your
              Profile — this is permanent and removes your personal data. If you own a household
              with other members, you&apos;ll need to transfer ownership first. For anything
              that self-service option doesn&apos;t cover, contact whoever administers your
              household&apos;s Squirrel instance (typically the household owner who invited
              you, or the person who set up the app) — see &quot;Contact&quot; in our{" "}
              <Link href="/privacy" className="text-primary underline underline-offset-4">
                Privacy policy
              </Link>
              .
            </p>
          </Section>

          <Section title="11. Contact" id="contact">
            <p>
              Questions about these terms? Reach out to whoever invited you to your household, or
              the person who operates your instance of Squirrel.
            </p>
          </Section>
        </article>
        )}
      </div>
    </div>
  );
}
