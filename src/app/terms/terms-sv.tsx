import Link from "next/link";
import {
  LegalJumpList,
  LegalSection as Section,
  type LegalJumpItem,
} from "@/components/legal/legal-page";

// UX-66: the Swedish text of the terms of service, a faithful translation of
// the English one in ./page.tsx. Keep the two in step (same sections, same
// ids, same meaning) whenever either changes, and bump LAST_UPDATED in both.
// Reviewed by the owner together with the privacy policy.

const LAST_UPDATED = "7 september 2026";

const SECTIONS: LegalJumpItem[] = [
  { id: "what", title: "1. Vad Squirrel är" },
  { id: "account", title: "2. Ditt konto" },
  { id: "households", title: "3. Hushåll är gemensamma ytor" },
  { id: "acceptable-use", title: "4. Tillåten användning" },
  { id: "content", title: "5. Ditt innehåll" },
  { id: "third-parties", title: "6. Tredjepartstjänster" },
  { id: "warranty", title: "7. Ingen garanti" },
  { id: "liability", title: "8. Ansvarsbegränsning" },
  { id: "changes", title: "9. Ändringar i villkoren" },
  { id: "ending", title: "10. Avsluta ditt konto" },
  { id: "contact", title: "11. Kontakt" },
];

export function TermsSv({ jumpListLabel }: { jumpListLabel: string }) {
  return (
    <article lang="sv" className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Användarvillkor</h1>
        <p className="text-sm text-muted-foreground">Senast uppdaterad: {LAST_UPDATED}</p>
      </header>

      <LegalJumpList label={jumpListLabel} items={SECTIONS} />

      <Section title="1. Vad Squirrel är" id="what">
        <p>
          Squirrel är ett verktyg för hushållsplanering där du håller koll på skafferiet, bygger
          inköpslistor, planerar måltider och för en gemensam eller personlig budget. Du skapar ett
          konto, sätter upp ett hushåll (eller går med i ett som någon annan redan har skapat, via
          en inbjudningslänk), och alla i hushållet kan se och hantera hushållets gemensamma
          uppgifter tillsammans.
        </p>
      </Section>

      <Section title="2. Ditt konto" id="account">
        <p>
          Du behöver ett konto (e-postadress, lösenord och visningsnamn) för att använda Squirrel.
          Du ansvarar för att hålla ditt lösenord hemligt och för all aktivitet under ditt konto.
          Meddela oss om du tror att någon har fått tillgång till ditt konto utan din tillåtelse.
        </p>
        <p>
          Du måste ange korrekta uppgifter när du skapar ett konto, och du måste vara gammal nog
          enligt lagen i ditt land för att själv ingå dessa villkor.
        </p>
      </Section>

      <Section title="3. Hushåll är gemensamma ytor" id="households">
        <p>
          Ett hushåll är en gemensam arbetsyta: dess skafferi, inköpslistor, recept, matplaner och
          gemensamma budget kan ses och redigeras av alla medlemmar som du eller en annan medlem
          bjuder in. Bjud bara in personer du faktiskt vill dela de här uppgifterna med.
        </p>
        <p>
          Varje hushåll har en ägare (den som skapade det, om inte ägarskapet senare överlåts till
          en annan medlem) och valfritt antal medlemmar. Ägaren kan ta bort medlemmar och kan ta
          bort hushållet permanent – vilket raderar alla dess gemensamma uppgifter för alla
          medlemmar, utan möjlighet att ångra det. Medlemmar kan lämna ett hushåll när som helst
          från sitt eget konto.
        </p>
        <p>
          Din personliga budget (till skillnad från ett hushålls gemensamma budget) tillhör bara
          ditt eget konto – andra hushållsmedlemmar kan inte se den.
        </p>
      </Section>

      <Section title="4. Tillåten användning" id="acceptable-use">
        <p>Du förbinder dig att inte:</p>
        <ul className="list-disc pl-5">
          <li>Använda Squirrel för något olagligt, eller för att lagra eller dela innehåll som du inte har rätt att lagra eller dela;</li>
          <li>Försöka komma åt ett annat hushålls uppgifter utan en giltig inbjudan;</li>
          <li>Försöka kringgå begränsningar av antalet förfrågningar, leta efter sårbarheter eller på annat sätt störa tjänstens normala drift;</li>
          <li>Använda inbjudningsfunktionen för att skicka oombedd e-post till personer som inte har bett om att få gå med i ditt hushåll.</li>
        </ul>
      </Section>

      <Section title="5. Ditt innehåll" id="content">
        <p>
          Du behåller äganderätten till det innehåll du och ditt hushåll skriver in – varor i
          skafferiet, inköpslistor, recept, matplaner, budgetposter och liknande. Du ger oss bara
          den begränsade rätten att lagra, behandla och visa innehållet för dig och dina
          hushållsmedlemmar, uteslutande för att driva tjänsten åt dig.
        </p>
      </Section>

      <Section title="6. Tredjepartstjänster" id="third-parties">
        <p>
          När du skickar en hushållsinbjudan via e-post använder vi Resend, en leverantör av
          transaktionell e-post, för att leverera meddelandet. Se vår{" "}
          <Link href="/privacy" className="text-primary underline underline-offset-4">
            Integritetspolicy
          </Link>{" "}
          för vad det innebär. Vi använder inga reklam- eller analystjänster.
        </p>
      </Section>

      <Section title="7. Ingen garanti" id="warranty">
        <p>
          Squirrel är en liten, personligt driven applikation som tillhandahålls ”i befintligt
          skick” utan garantier av något slag, vare sig uttryckliga eller underförstådda. Vi
          garanterar inte att tjänsten är oavbruten, felfri eller tillgänglig hela tiden. Du
          ansvarar själv för att behålla egna kopior av sådant du inte har råd att förlora – till
          exempel genom att exportera budgetuppgifter där appen stöder det.
        </p>
        <p>
          Ingenting i dessa villkor begränsar några lagstadgade rättigheter du har som konsument
          som inte kan uteslutas enligt lagen i ditt bosättningsland, inklusive enligt EU:s eller
          Sveriges konsumentskyddslagstiftning där den är tillämplig.
        </p>
      </Section>

      <Section title="8. Ansvarsbegränsning" id="liability">
        <p>
          I den utsträckning lagen tillåter är Squirrel och den som driver den här instansen inte
          ansvariga för indirekta skador, följdskador eller tillfälliga skador som uppstår av din
          användning av tjänsten, inklusive förlust av data.
        </p>
      </Section>

      <Section title="9. Ändringar i villkoren" id="changes">
        <p>
          Vi kan uppdatera dessa villkor när tjänsten förändras. Om vi gör en väsentlig ändring
          uppdaterar vi datumet för ”Senast uppdaterad” ovan. Om du fortsätter att använda
          Squirrel efter en ändring godkänner du de uppdaterade villkoren.
        </p>
      </Section>

      <Section title="10. Avsluta ditt konto" id="ending">
        <p>
          Du kan lämna vilket hushåll du tillhör när som helst. En hushållsägare kan när som helst
          ta bort sitt hushåll från hushållets inställningar, vilket är permanent. För att stänga
          ditt konto helt använder du ”Radera konto” i din profil – det är permanent och tar bort
          dina personuppgifter. Om du äger ett hushåll med andra medlemmar måste du först överlåta
          ägarskapet. För allt som det alternativet inte täcker, kontakta den som administrerar
          ditt hushålls instans av Squirrel (vanligtvis hushållsägaren som bjöd in dig, eller den
          som satte upp appen) – se ”Kontakt” i vår{" "}
          <Link href="/privacy" className="text-primary underline underline-offset-4">
            Integritetspolicy
          </Link>
          .
        </p>
      </Section>

      <Section title="11. Kontakt" id="contact">
        <p>
          Frågor om dessa villkor? Hör av dig till den som bjöd in dig till ditt hushåll, eller
          till den som driver din instans av Squirrel.
        </p>
      </Section>
    </article>
  );
}
