import { Icon } from "./Icon";
import "./RatingStars.css";

export function RatingStars({ rating, count, size = 14 }: { rating: number; count?: number; size?: number }) {
  return (
    <span className="pm-rating">
      <Icon name="star-filled" size={size} className="pm-rating-star" />
      <span className="pm-rating-value">{rating > 0 ? rating.toFixed(1) : "New"}</span>
      {typeof count === "number" && <span className="pm-rating-count">({count.toLocaleString()})</span>}
    </span>
  );
}
