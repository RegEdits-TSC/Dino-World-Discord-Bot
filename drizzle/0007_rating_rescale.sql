-- Rating moved from a 500-point scale to 1000, and every gate doubled with it.
-- rating_high_water is the column that matters: it is monotonic and gates lot
-- slots, site and chapter unlocks, the shop ceiling, and Mythic, so a player
-- below their historic peak would never recover it by playing. park_rating
-- self-heals on the next recomputeRating.
UPDATE users SET park_rating = park_rating * 2, rating_high_water = rating_high_water * 2;
