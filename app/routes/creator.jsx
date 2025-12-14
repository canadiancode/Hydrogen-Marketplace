import {Outlet} from 'react-router';
import {CreatorLayout} from '~/components/creator/CreatorLayout';

/**
 * Route handle to mark creator routes that should hide header/footer
 * This can be accessed via useMatches() in parent layouts
 */
export const handle = {
  hideHeaderFooter: true,
};

export default function CreatorRoute() {
  return (
    <CreatorLayout>
      <Outlet />
    </CreatorLayout>
  );
}