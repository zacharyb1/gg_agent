BRRAWL STARS — local image assets
=================================

The game looks for these 6 files in this folder. Any that are missing
gracefully fall back to the built-in procedural drawing — so you can
drop in just one or two and the rest will keep working.

Required filenames (case-sensitive):

  shelly.png    -- balanced brawler  (the player + the red mirror)
  elprimo.png   -- heavy brawler
  max.png       -- fast brawler
  bullet.png    -- single projectile sprite (rotated to match flight)
  grass.png     -- tilable ground texture
  bush.png      -- single bush decoration

Where to get them
-----------------
Supercell fankit:
https://fankit.supercell.com/d/YvtsWV4pUQVm/game-assets

The fankit has 8000+ images. Use the search bar to narrow:

  search "shelly"       -> save as shelly.png
  search "el primo"     -> save as elprimo.png
  search "max"          -> save as max.png
  search "bush"         -> save as bush.png
  search "grass" / "tile" / "ground" -> save as grass.png
  search "shell" / "ammo" / "bullet" -> save as bullet.png

Pick variants that are:
  - PNG with transparent background
  - Roughly square / portrait, front-facing if possible
  - Not too large (256-512px is plenty)

How they are used
-----------------
- Brawler sprites are scaled to ~3.2x the unit radius and flipped
  horizontally based on aim direction.
- The same sprite is used for both teams; team identity is shown by
  the colored "puck" under the unit's feet and the name tag color.
- Bullet sprite is rotated to match flight direction.
- Grass tiles via createPattern (any size works).

Per Supercell's Fan Content Policy: keep this project non-commercial,
do not sell the resulting build, and do not imply Supercell endorsement.
