import Link from "next/link";
import {
  CookieList,
  LegalJumpList,
  LegalSection as Section,
  type LegalJumpItem,
} from "@/components/legal/legal-page";

// UX-66: the Swedish text of the privacy policy, a faithful translation of
// the English one in ./page.tsx. Keep the two in step (same sections, same
// ids, same meaning) whenever either changes, and bump LAST_UPDATED in both.
// Human-only area (AUTOPILOT.md): the owner reviews the wording.

const LAST_UPDATED = "25 september 2026";

const SECTIONS: LegalJumpItem[] = [
  { id: "overview", title: "1. Översikt" },
  { id: "who", title: "2. Vem policyn gäller" },
  { id: "collect", title: "3. Vad vi samlar in" },
  { id: "cookies", title: "4. Cookies och lokal lagring" },
  { id: "invites", title: "5. Inbjudningar till hushåll" },
  { id: "third-parties", title: "6. Tredje parter" },
  { id: "legal-basis", title: "7. Rättslig grund för behandlingen (användare inom EU/EES)" },
  { id: "retention", title: "8. Hur länge vi sparar uppgifter" },
  { id: "rights", title: "9. Dina rättigheter och hur du utövar dem" },
  { id: "children", title: "10. Barn" },
  { id: "security", title: "11. Säkerhet" },
  { id: "changes", title: "12. Ändringar i policyn" },
  { id: "contact", title: "13. Kontakt" },
];

export function PrivacySv({ jumpListLabel }: { jumpListLabel: string }) {
  return (
    <article lang="sv" className="flex min-w-0 flex-col gap-8 break-words hyphens-auto">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Integritetspolicy</h1>
        <p className="text-sm text-muted-foreground">Senast uppdaterad: {LAST_UPDATED}</p>
      </header>

      <LegalJumpList label={jumpListLabel} items={SECTIONS} />

      <Section title="1. Översikt" id="overview">
        <p>
          Den här policyn förklarar vilka personuppgifter Squirrel samlar in, varför, och vad (om
          något) som delas med andra. Squirrel är en liten app för hushållsplanering – den är inte
          annonsfinansierad, kör inga analys- eller spårningsskript av något slag (se ”Cookies och
          lokal lagring” och ”Tredje parter” nedan för de små detaljerna) och säljer eller hyr inte
          ut dina uppgifter till någon.
        </p>
      </Section>

      <Section title="2. Vem policyn gäller" id="who">
        <p>
          ”Vi” avser den som driver den instans av Squirrel som ditt konto finns på – vanligtvis
          den som har satt upp den åt dig och ditt hushåll, eller hushållets ägare som bjöd in dig.
          Squirrel är inget stort multi-tenant-SaaS-företag med ett särskilt integritetsteam; det
          är en egendriven app, så när policyn säger att du ska kontakta ”oss” menas den personen.
        </p>
      </Section>

      <Section title="3. Vad vi samlar in" id="collect">
        <p>När du skapar ett konto sparar vi:</p>
        <ul className="list-disc pl-5">
          <li>Din e-postadress (används för att logga in, för att skicka inbjudningar om du blir inbjuden till eller bjuder in andra till ett hushåll, och för att skicka veckosammanfattningen om du slår på den);</li>
          <li>Ditt lösenord – aldrig i klartext. Det hashas med bcrypt innan det sparas, så att vi kan kontrollera det vid inloggning men inte kan se eller återskapa ditt ursprungliga lösenord;</li>
          <li>Ditt visningsnamn;</li>
          <li>Ditt Swish-nummer, endast om du lägger till ett i din profil – det visas för medlemmarna i dina hushåll så att de kan betala tillbaka till dig med Swish, och du kan ta bort det där när som helst;</li>
          <li>Vilka hushåll du tillhör och din roll i vart och ett (ägare eller medlem).</li>
        </ul>
        <p>Utöver ditt konto sparar Squirrel det innehåll du och ditt hushåll skriver in för att använda funktionerna:</p>
        <ul className="list-disc pl-5">
          <li>Gemensamma hushållsuppgifter: varor i skafferiet (inklusive eventuella streckkoder du kopplar till dem, så att en ny skanning hittar varan), inköpslistor, recept, matplaner samt hushållets gemensamma budgetkategorier och transaktioner – synliga för alla medlemmar i hushållet;</li>
          <li>Din personliga budget: kategorier och transaktioner som du för för egen del, synliga bara för dig.</li>
        </ul>
        <p>Cookies och lokal lagring beskrivs separat i nästa avsnitt.</p>
      </Section>

      <Section title="4. Cookies och lokal lagring" id="cookies">
        <p>
          Squirrel sparar bara små uppgifter på din enhet som antingen är absolut nödvändiga för
          att de funktioner du använder ska fungera (att hålla dig inloggad, att hålla ditt hushåll
          valt) eller som kommer ihåg en inställning du själv har gjort (språk, tema, sidofält).
          Ingen av dem används för reklam, analys eller spårning, och ingen delas med en tredje
          part. Därför ber vi inte om samtycke – vi berättar bara om dem här. Du kan ta bort vilken
          som helst via webbläsarens inställningar för webbplatsdata; det enda som händer är att du
          loggas ut och att dina inställningar återställs.
        </p>
        <CookieList
          locale="sv"
          labels={{
            name: "Namn",
            type: "Typ",
            purpose: "Syfte",
            lasts: "Varaktighet",
            cookie: "Cookie",
            cache: "Offlinecache",
            localStorage: "Lokal lagring",
            necessary: "nödvändig",
            preference: "inställning",
          }}
        />
        <p>
          Över en säker anslutning (HTTPS) har inloggningscookies ett prefix som webbläsaren
          tvingar fram (<code>__Secure-</code> eller <code>__Host-</code>) framför namnen ovan. Om
          du slår på pushnotiser sparar webbläsaren dessutom en service worker och en
          pushprenumeration för den här webbplatsen; det är helt frivilligt via webbläsarens egen
          behörighetsfråga och kan återkallas på samma ställe eller från din profilsida.
        </p>
      </Section>

      <Section title="5. Inbjudningar till hushåll" id="invites">
        <p>
          När du bjuder in någon till ditt hushåll via e-post skickar vi det e-postmeddelandet via
          Resend, en leverantör av transaktionell e-post – se ”Tredje parter” nedan. Mottagarens
          e-postadress skickas till Resend för att leverera just det meddelandet och sparas inte
          i övrigt i vår databas; själva inbjudningslänken (en slumpmässig token med
          utgångsdatum) sparas så att den kan slås upp och lösas in när mottagaren öppnar den.
        </p>
      </Section>

      <Section title="6. Tredje parter" id="third-parties">
        <p>
          <strong>Resend</strong> får personuppgifter bara för att leverera konto- och
          hushållsinbjudningar via e-post (mottagarens e-postadress, det inbjudande hushållets namn
          och länken) och, bara om du har slagit på det i din profil, den veckovisa
          hushållssammanfattningen (din e-postadress och veckans sammanfattning: hushållets namn,
          titlar på slutförda uppgifter och vem som gjorde dem, namn på varor som närmar sig sitt
          datum, hur många recept som planerats och månadens hushållsbudget). Sammanfattningen är
          avstängd som standard och varje utskick har en avregistreringslänk som fungerar utan
          inloggning. Resend behandlar uppgifterna för vår räkning som personuppgiftsbiträde, enligt
          sin egen integritetspolicy. Om e-postutskick inte är konfigurerat på din instans fungerar
          inbjudningar enbart via den delbara länken på skärmen, och ingen e-post – eller några
          uppgifter – skickas någonstans.
        </p>
        <p>
          <strong>Open Food Facts</strong>, en kostnadsfri och öppen produktdatabas, tillfrågas om
          en produkts namn och kategori när du skannar en streckkod som Squirrel inte känner igen
          ännu. Bara streckkodens siffror skickas, från vår server – kamerabilden avkodas på din
          enhet och lämnar den aldrig, och inga konto- eller hushållsuppgifter följer med
          förfrågan. En streckkod som du redan har kopplat till en av dina varor slås i stället upp
          i ditt eget skafferi, och inget skickas.
        </p>
        <p>
          <strong>Din webbläsares taligenkänning</strong> används när du trycker på
          mikrofonknappen i en inköpslista för att lägga till varor med rösten. Squirrel spelar
          inte in eller tar emot något ljud – det får bara den text som webbläsaren lämnar tillbaka,
          och den läggs till precis som om du hade skrivit den. Men vissa webbläsare känner inte
          igen tal på din enhet: Chrome och Edge skickar till exempel inspelningen till Googles
          respektive Microsofts servrar, och Safari kan skicka den till Apple, enligt det företagets
          egen integritetspolicy. Inget spelas in förrän du trycker på knappen, lyssnandet slutar
          efter en mening, och om du hellre inte vill använda det fungerar det precis likadant att
          skriva. Webbläsare utan taligenkänning visar inte knappen alls.
        </p>
        <p>
          <strong>Gemini</strong> (Google) och <strong>Anthropic</strong> används av tre
          valfria AI-funktioner, och bara när den som driver din instans har konfigurerat en
          API-nyckel för någon av dem – utan konfigurerad nyckel körs inget av detta.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>AI-skanning av hyllor</strong> och <strong>AI-skanning av kvitton</strong>{" "}
            körs bara när du startar dem. Båda laddar upp fotot du tar (av en hylla, ett kylskåp
            eller ett skåp, eller av ett papperskvitto) så att en bildmodell kan läsa det. I
            hyllskanningens läge ”Inventera” skickas namnen på hushållets nuvarande varor
            (upp till 300) med fotot, så att modellen kan matcha det den ser mot dem. Själva fotot
            sparas aldrig i vår databas – bara de rader du granskar och bekräftar efteråt sparas.
          </li>
          <li>
            <strong>AI-kategorisering</strong> körs automatiskt, i bakgrunden, när du lägger till
            en ny vara vars namn varken den inbyggda ordlistan eller hushållets tidigare varor
            känner igen. Bara varunamnen skickas – aldrig mängder, priser eller andra hushålls- eller
            kontouppgifter – och svaret används enbart för att fylla i varans kategori. Varan
            sparas direkt som ”Okategoriserad” i båda fallen, och en kategori som du redan har satt
            själv skrivs aldrig över.
          </li>
        </ul>
        <p>
          Vad Google och Anthropic gör med data som skickas till deras API:er styrs av deras egna
          API-villkor och integritetspolicyer.
        </p>
        <p>
          <strong>Sentry</strong> (felrapportering) är valfritt och aktivt bara om den som driver
          din instans har slagit på det. När det är aktivt skickas tekniska uppgifter om felet till
          Sentry om appen kraschar eller råkar ut för ett oväntat fel (felmeddelandet och
          stackspåret, sidadressen, din webbläsare och enhetstyp, och möjligen din IP-adress), så att
          problemet kan åtgärdas. Sentry agerar som personuppgiftsbiträde för vår räkning. Det är
          inte konfigurerat för att spela in sessioner, spåra din användning eller sätta cookies,
          och vi skickar inte medvetet innehållet i ditt skafferi, dina inköpslistor, matplaner
          eller din budget dit. Om din instans inte använder det skickas inget.
        </p>
        <p>
          Vi använder ingen analys- eller reklamtjänst. Det finns ingen spårningspixel och inget
          annonsnätverk. Bortsett från streckkodssiffrorna som skickas till Open Food Facts, de
          valfria AI-funktionerna från Gemini/Anthropic och talet som din egen webbläsare kan
          skicka till sin leverantör när du lägger till varor med rösten, allt beskrivet ovan,
          får ingen tredje part ditt skafferi, dina inköpslistor, matplaner eller din budget.
        </p>
      </Section>

      <Section title="7. Rättslig grund för behandlingen (användare inom EU/EES)" id="legal-basis">
        <p>
          Om du befinner dig inom EU/EES (inklusive Sverige) är vår rättsliga grund för att
          behandla dina konto- och hushållsuppgifter fullgörandet av det avtal som bildas av dessa
          villkor – vi behöver uppgifterna för att tillhandahålla de funktioner du har registrerat
          dig för. Begränsningen av antalet inloggnings- och registreringsförsök (för att
          bromsa gissning av lösenord) grundar sig på vårt berättigade intresse av att hålla
          tjänsten säker; den uppgiften finns bara i serverns minne, utgår från den e-postadress
          som försöket gäller och rensas automatiskt – den skrivs aldrig till databasen och sparas
          inte efter en omstart.
        </p>
      </Section>

      <Section title="8. Hur länge vi sparar uppgifter" id="retention">
        <p>
          Konto- och hushållsuppgifter sparas så länge kontot eller hushållet finns. En
          hushållsägare kan när som helst ta bort sitt hushåll permanent från hushållets
          inställningar (”Farozon”) – det raderar omedelbart och oåterkalleligt hushållets alla
          varor, inköpslistor, recept, matplaner och gemensamma budgetuppgifter för alla
          medlemmar. Att lämna ett hushåll tar bort ditt medlemskap och din åtkomst till dess
          uppgifter, men raderar inte ditt konto.
        </p>
      </Section>

      <Section title="9. Dina rättigheter och hur du utövar dem" id="rights">
        <p>
          Beroende på var du bor kan du ha rätt att få tillgång till, rätta, exportera eller
          radera dina personuppgifter, och att invända mot eller begränsa viss behandling – för
          användare inom EU/EES och i Sverige följer dessa rättigheter av GDPR.
        </p>
        <p>
          Du kan utöva de flesta av dessa rättigheter själv, utan att kontakta någon: använd
          ”Exportera mina data” i din profil för att ladda ner en kopia av dina personuppgifter,
          eller ”Radera konto” där för att ta bort ditt konto permanent. Du kan också när som helst
          radera ditt eget innehåll (till exempel enskilda varor, inköpslistor eller
          budgetposter) i appen. För allt som de verktygen inte täcker, kontakta hushållsägaren som
          bjöd in dig, eller den som driver din instans av Squirrel.
        </p>
      </Section>

      <Section title="10. Barn" id="children">
        <p>
          Squirrel riktar sig inte till barn och används inte medvetet för att samla in
          personuppgifter från någon som är under den ålder som krävs för att samtycka till
          personuppgiftsbehandling enligt lokal lag (13 år i de flesta sammanhang, 16 år enligt
          GDPR om inte landet har satt en lägre gräns). Om du tror att ett barn har skapat ett
          konto, kontakta instansens operatör så att det kan tas bort.
        </p>
      </Section>

      <Section title="11. Säkerhet" id="security">
        <p>
          Lösenord hashas innan de sparas och är aldrig synliga för någon, inte heller för den som
          driver din instans. Inloggnings- och registreringsförsök är begränsade för att bromsa
          automatiserad gissning. Inget system är helt säkert, så vi kan inte garantera absolut
          säkerhet för uppgifter du skickar till oss.
        </p>
      </Section>

      <Section title="12. Ändringar i policyn" id="changes">
        <p>
          Om policyn ändras uppdaterar vi datumet för ”Senast uppdaterad” ovan. Väsentliga
          ändringar – till exempel om en ny tredjepartstjänst någonsin läggs till – speglas här
          innan de träder i kraft.
        </p>
      </Section>

      <Section title="13. Kontakt" id="contact">
        <p>
          För frågor om den här policyn eller dina uppgifter, kontakta hushållsägaren som bjöd in
          dig, eller den som driver din instans av Squirrel. Se även våra{" "}
          <Link href="/terms" className="text-primary underline underline-offset-4">
            Användarvillkor
          </Link>
          .
        </p>
      </Section>
    </article>
  );
}
