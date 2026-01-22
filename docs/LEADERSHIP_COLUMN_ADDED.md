# Leadership Column Addition - Summary

## Changes Made

### 1. Index Table (`public/html/index.html`)

**Added "Leadership" column header** (after "Presence %", before "Activity Index")
```html
<th class="sortable">Leadership</th>
```

**Added to sort key mapping**:
```javascript
"Leadership": "position_leadership_score"
```

**Added to sort dropdown filter**:
```html
<option value="position_leadership_score">Leadership (High→Low)</option>
```

**Added to table row data**:
```javascript
<td class="number">${m.position_leadership_score ?? 0}</td>
```

**Column order** (left to right):
1. Name
2. Party
3. Province
4. Presence %
5. **Leadership** (NEW)
6. Activity Index
7. Tenure
8. House Intrvn
9. Cmte Intrvn
10. Bills
11. Committees
12. Assoc.

### 2. Member Detail Page (`public/html/member.html`)

**Added Leadership Score display** (next to Activity Index)
- Shows position_leadership_score with 1 decimal place
- Formatted to match Activity Index styling
- Located in profile header section

**Added JavaScript to populate**:
```javascript
document.getElementById("leadershipScore").textContent = (m.position_leadership_score ?? 0).toFixed(1);
```

## Features

### Index Table
- ✅ Sortable by clicking "Leadership" column header
- ✅ Sortable via dropdown: "Leadership (High→Low)"
- ✅ Displays score as numeric value (0-100)
- ✅ Fully integrated with existing filtering/search

### Member Profile Page
- ✅ Displays leadership score prominently
- ✅ Shows with one decimal place (e.g., "93.0", "80.5")
- ✅ Positioned next to Activity Index for easy comparison
- ✅ Part of the header metrics display

## Data Displayed

**Leadership Scores (from Parliament 45, Session 1)**:
- Range: 0-100
- Average: 15.36
- Maximum: 93 (Prime Minister)
- Distribution:
  - 0-20: 251 members (73%) - backbenchers, low leadership roles
  - 20-40: 42 members (12%) - committee vice-chairs, deputy whips
  - 40-60: 9 members (3%) - Parliamentary Secretaries
  - 60-100: 41 members (12%) - Ministers, party leaders, PM

## Testing

To verify the changes are working:

1. **Index Table**: 
   - Navigate to `/` (homepage)
   - Look for "Leadership" column between "Presence %" and "Activity Index"
   - Try sorting by clicking the column header or using the "Sort By" dropdown
   - Verify scores display correctly

2. **Member Profile**:
   - Click on any member in the table
   - Should see Leadership Score displayed prominently in the profile header
   - Try a member with high leadership (e.g., Mark Carney - 93.0)
   - Try a backbencher (score 0)

## Files Modified

- [public/html/index.html](public/html/index.html) - Table column, sorting, display
- [public/html/member.html](public/html/member.html) - Profile display

---

**Status**: ✅ Complete  
**Ready**: Immediate use in dashboard
