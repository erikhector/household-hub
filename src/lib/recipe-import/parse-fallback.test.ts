import { describe, expect, it } from "vitest";
import { parseHeuristicRecipe } from "./parse-heuristic";
import { parseMicrodataRecipe } from "./parse-microdata";

describe("parseMicrodataRecipe", () => {
  const microdataPage = `
    <html>
      <head><title>Grandma's Meatballs | Old Blog</title></head>
      <body>
        <nav><h1>Old Blog</h1></nav>
        <div itemscope itemtype="http://schema.org/Recipe">
          <h2 itemprop="name">Grandma&#8217;s Meatballs</h2>
          <div itemprop="author" itemscope itemtype="http://schema.org/Person">
            By <span itemprop="name">Grandma</span>
          </div>
          <span itemprop="recipeYield">4</span>
          <ul>
            <li itemprop="recipeIngredient">500 g ground beef</li>
            <li itemprop="recipeIngredient">1 <b>egg</b></li>
            <li itemprop="recipeIngredient">salt &amp; pepper</li>
          </ul>
          <ol>
            <li itemprop="recipeInstructions" itemscope itemtype="http://schema.org/HowToStep">
              <span itemprop="text">Mix everything.</span>
            </li>
            <li itemprop="recipeInstructions" itemscope itemtype="http://schema.org/HowToStep">
              <span itemprop="text">Roll and fry.</span>
            </li>
          </ol>
        </div>
      </body>
    </html>
  `;

  it("reads the Recipe item's own properties, ignoring nested items' `name`", () => {
    expect(parseMicrodataRecipe(microdataPage)).toEqual({
      name: "Grandma’s Meatballs",
      instructions: "Mix everything.\nRoll and fry.",
      ingredients: [
        { name: "ground beef", quantity: 500, unit: "g", rawText: "500 g ground beef" },
        { name: "egg", quantity: 1, unit: "pcs", rawText: "1 egg" },
        { name: "salt", quantity: 1, unit: "pcs", rawText: "salt & pepper" },
        { name: "pepper", quantity: 1, unit: "pcs", rawText: "salt & pepper" },
      ],
    });
  });

  it("honors `content` attributes, the legacy `ingredients` prop, and https itemtypes", () => {
    const html = `
      <article itemscope itemtype="https://schema.org/Recipe">
        <meta itemprop="name" content="Toast">
        <p itemprop="ingredients">2 slices bread</p>
        <div itemprop="recipeInstructions"><p>Toast the bread.</p><p>Butter it.</p></div>
      </article>
    `;
    expect(parseMicrodataRecipe(html)).toEqual({
      name: "Toast",
      instructions: "Toast the bread.\nButter it.",
      ingredients: [{ name: "bread", quantity: 2, unit: "slices", rawText: "2 slices bread" }],
    });
  });

  it("falls back to the page's <h1> when the item has no name", () => {
    const html = `
      <h1>Plain Rice</h1>
      <div itemscope itemtype="http://schema.org/Recipe">
        <span itemprop="recipeIngredient">2 dl ris</span>
      </div>
    `;
    expect(parseMicrodataRecipe(html)?.name).toBe("Plain Rice");
  });

  it("returns null without a Recipe itemscope", () => {
    const html = `<div itemscope itemtype="http://schema.org/Person"><span itemprop="name">X</span></div>`;
    expect(parseMicrodataRecipe(html)).toBeNull();
  });
});

describe("parseHeuristicRecipe", () => {
  it("reads the title plus the lists under Ingredients/Instructions headings", () => {
    const html = `
      <html>
        <head><title>Lemon Cake - Some Blog</title></head>
        <body>
          <h1>Lemon Cake</h1>
          <p>My kids love this cake. Here are some ingredients I considered…</p>
          <ul><li>Not an ingredient, a nav link</li></ul>
          <h2>Ingredients:</h2>
          <h3>For the cake</h3>
          <ul>
            <li>2 cups flour</li>
            <li>1 cup sugar
          </ul>
          <h3>For the glaze</h3>
          <ul><li>1 lemon</li></ul>
          <h2>Instructions</h2>
          <ol><li>Bake the cake.</li><li>Glaze it.</li></ol>
          <h2>Comments</h2>
          <ul><li>Great recipe!</li></ul>
        </body>
      </html>
    `;
    expect(parseHeuristicRecipe(html)).toEqual({
      name: "Lemon Cake",
      instructions: "Bake the cake.\nGlaze it.",
      ingredients: [
        { name: "flour", quantity: 2, unit: "cups", rawText: "2 cups flour" },
        { name: "sugar", quantity: 1, unit: "cup", rawText: "1 cup sugar" },
        { name: "lemon", quantity: 1, unit: "pcs", rawText: "1 lemon" },
      ],
    });
  });

  it("handles Swedish headings, a <title>-only name, and paragraph steps", () => {
    const html = `
      <head><title>Pannkakor | Matbloggen</title></head>
      <h3>Ingredienser till 4 portioner</h3>
      <ul><li>3 dl vetemjöl</li><li>6 dl mjölk</li><li>3 st ägg</li></ul>
      <h3>Gör så här</h3>
      <p>Vispa ihop allt.</p>
      <p>Stek tunna pannkakor.
      <h3>Fler recept</h3>
      <p>Prova även våfflor!</p>
    `;
    expect(parseHeuristicRecipe(html)).toEqual({
      name: "Pannkakor",
      instructions: "Vispa ihop allt.\nStek tunna pannkakor.",
      ingredients: [
        { name: "vetemjöl", quantity: 3, unit: "dl", rawText: "3 dl vetemjöl" },
        { name: "mjölk", quantity: 6, unit: "dl", rawText: "6 dl mjölk" },
        { name: "ägg", quantity: 3, unit: "st", rawText: "3 st ägg" },
      ],
    });
  });

  it("returns null when there's no ingredients heading (a title alone isn't a recipe)", () => {
    const html = `<h1>Why these ingredients matter</h1><ul><li>2 cups flour</li></ul>`;
    expect(parseHeuristicRecipe(html)).toBeNull();
  });

  it("returns null when the ingredients heading has nothing under it", () => {
    expect(parseHeuristicRecipe(`<h1>Cake</h1><h2>Ingredients</h2><h2>Method</h2>`)).toBeNull();
  });
});

