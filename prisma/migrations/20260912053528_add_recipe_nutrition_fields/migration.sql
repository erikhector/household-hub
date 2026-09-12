-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "caloriesPerServing" INTEGER,
ADD COLUMN     "proteinGramsPerServing" DOUBLE PRECISION,
ADD COLUMN     "carbsGramsPerServing" DOUBLE PRECISION,
ADD COLUMN     "fatGramsPerServing" DOUBLE PRECISION;
