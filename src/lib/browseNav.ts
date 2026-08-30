import { SavedSearchCriteria } from '../types';

// "Show me this category" from somewhere outside the browse stack -- a
// listing's own category line, a saved search, a banner pointing at a
// category. Three call sites that had drifted into three different
// cross-navigator jumps, two of them broken in one way and the third in
// another.
//
// The two that pushed: navigate('MainTabs', { screen: 'HomeTab', ... })
// from a root-stack screen, where MainTabs is not the focused route. In
// React Navigation 7 navigate only reuses a route that is already focused
// -- anything else is a push -- so each of those stacked a SECOND whole
// tab navigator on top of the first. Back walked through an identical
// copy of the app, and two tab navigators sat mounted at once, each with
// its own state. `pop: true` is what turns that push back into a return.
//
// The third did nothing at all: it addressed 'HomeTab', and navigate
// bubbles UP through parent navigators, never down into a child. See
// bannerLink.
//
// The Home stack is then SET rather than navigated into. Coming from
// outside there is no trail worth preserving, and building one explicitly
// is what makes back predictable: the gate sits under the category, so
// browse is always left the same way whatever brought you in. Two costs,
// both accepted: the gate is remounted, so anything typed in its search
// box is gone; and a section home the buyer had open underneath is
// dropped, so the system back button goes to the gate while the scope
// bar's own back link still offers the section (it re-creates it -- see
// HomeScreen's clearAllCategories). It also happens to fix the saved
// search that would not re-apply: seeding runs in HomeScreen's mount
// initialisers, and reusing an existing HomeCategory route reused its key
// and never re-mounted.
//
// Deliberately not typed against RootStackParamList: two callers are
// root-stack screens and the third is the banner helper, handed whatever
// navigation object its host had. All three passed `as any` here
// individually before.
export function openCategoryFromOutside(
  navigation: any,
  categoryId: string,
  applyCriteria?: SavedSearchCriteria
) {
  navigation.navigate(
    'MainTabs',
    {
      screen: 'HomeTab',
      params: {
        state: {
          routes: [
            { name: 'HomeRoot' },
            {
              name: 'HomeCategory',
              params: { cat: categoryId, ...(applyCriteria ? { applyCriteria } : {}) },
            },
          ],
        },
      },
    },
    { pop: true }
  );
}
