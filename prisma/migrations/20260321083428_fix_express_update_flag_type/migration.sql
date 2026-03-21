/*
  Warnings:

  - The `update_flag` column on the `express` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "express" DROP COLUMN "update_flag",
ADD COLUMN     "update_flag" VARCHAR(8);
