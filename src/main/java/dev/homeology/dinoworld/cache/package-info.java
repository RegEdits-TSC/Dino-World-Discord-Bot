/**
 * In-process cache plumbing — Caffeine-backed named caches plus a
 * logging decorator.
 *
 * <p>Marked {@link org.jspecify.annotations.NullMarked @NullMarked}, so
 * every reference type in this package is non-null unless explicitly
 * tagged {@link org.jspecify.annotations.Nullable @Nullable}. JSpecify
 * is on the compile classpath via Caffeine, so no new dependency is
 * needed to use these annotations elsewhere in the codebase — applying
 * the same pattern (one {@code package-info.java} per package) is
 * the project-wide convention for nullness contracts.
 */
@NullMarked
package dev.homeology.dinoworld.cache;

import org.jspecify.annotations.NullMarked;
