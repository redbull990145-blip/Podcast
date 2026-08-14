import type { IconPath } from '@cue/design';
import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * An icon from the shared path data.
 *
 * The same 24×24 geometry the web renders inline, so the two platforms cannot
 * end up with different-looking icons for the same destination.
 */
export function Icon({
  path,
  size = 22,
  color,
  filled = false,
}: {
  path: IconPath;
  size?: number;
  /** `ColorValue`, not `string` — navigation hands its tint colours as opaque
   * platform values, and narrowing here would push a cast to every caller. */
  color: ColorValue;
  filled?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={path}
        fill={filled ? color : 'none'}
        stroke={filled ? 'none' : color}
        strokeWidth={filled ? 0 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
