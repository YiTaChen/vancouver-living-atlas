/** Keep the source's required legend visible beside derived transit data. */
export function TransitAttribution() {
  return (
    <aside
      aria-label="Transit data attribution"
      style={{
        maxWidth: 640,
        padding: '8px 12px',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <span>
        Offline TransLink GTFS · Bus 5 / 6 · Expo / Canada Line · Illustrative
        service timing
      </span>
      <p style={{ margin: '4px 0' }}>
        Route and arrival data used in this product or service is provided by
        permission of TransLink. TransLink assumes no responsibility for the
        accuracy or currency of the Data used in this product or service.
      </p>
      <a
        href="https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data"
        target="_blank"
        rel="noreferrer"
      >
        Data source and terms
      </a>
    </aside>
  );
}
