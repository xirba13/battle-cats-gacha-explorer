import re
import tracker

SOLUTION_FILE = 'all_solutions.md'

def parse_solutions(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    solutions = []
    current_steps = []
    current_solution_name = "Unknown Solution"
    
    for i, line in enumerate(lines):
        line = line.strip()
        
        # Check for new solution header
        # Handle corrupted lines like "... -> 1## Solution 9"
        if '## Solution' in line:
            # If we have accumulated steps for a previous solution, save them
            if current_steps:
                solutions.append({'name': current_solution_name, 'steps': current_steps})
                current_steps = []
            
            # Extract new name
            parts = line.split('## Solution')
            if len(parts) > 1:
                current_solution_name = f"Solution{parts[1].strip()}"
            else:
                current_solution_name = "Solution"
            
            # If the line started with a step before the header (corrupted line), parse it?
            # Example: "- 🎫 ... -> 1## Solution 9"
            # It's safer to ignore the corrupted step as it's likely incomplete.
            continue

        if line.startswith('- 🎫'):
            # Single Roll
            match = re.search(r'Banner (\d+)', line)
            if match:
                banner_idx = int(match.group(1)) - 1
                current_steps.append({
                    'type': 'roll',
                    'banner': banner_idx,
                    'line': i + 1,
                    'raw': line
                })
        elif line.startswith('- 🎰'):
            # Guaranteed 11-Draw
            match = re.search(r'Banner (\d+)', line)
            if match:
                banner_idx = int(match.group(1)) - 1
                
                # Look ahead for Full Draw details
                full_draw_raw = None
                if i + 1 < len(lines):
                    next_line = lines[i+1].strip()
                    if next_line.startswith('> Full Draw:'):
                        full_draw_raw = next_line

                current_steps.append({
                    'type': '11-draw',
                    'banner': banner_idx,
                    'line': i + 1,
                    'raw': line,
                    'full_draw_raw': full_draw_raw
                })
    
    # Add the last solution
    if current_steps:
        solutions.append({'name': current_solution_name, 'steps': current_steps})
        
    return solutions

def verify_path():
    print(f"Loading data from {tracker.DATA_FILE}...")
    banners = tracker.parse_data(tracker.DATA_FILE)
    
    print(f"Loading solutions from {SOLUTION_FILE}...")
    solutions = parse_solutions(SOLUTION_FILE)
    print(f"Found {len(solutions)} solutions.")
    
    for sol_idx, sol in enumerate(solutions):
        print(f"\n{'='*20}")
        print(f"Verifying {sol['name']} ({len(sol['steps'])} steps)")
        print(f"{'='*20}")
        
        current_pos = "1A"
        last_unit = None
        valid = True
        
        for i, step in enumerate(sol['steps']):
            b_idx = step['banner']
            if b_idx < 0 or b_idx >= len(banners):
                print(f"Error at step {i+1} (Line {step['line']}): Invalid banner index {b_idx+1}")
                valid = False
                break

            banner = banners[b_idx]
            entry = banner.get(current_pos)
            
            if not entry:
                print(f"Error at step {i+1} (Line {step['line']}): Position {current_pos} not found in Banner {b_idx+1}")
                valid = False
                break

            # print(f"Step {i+1}: {step['type']} on Banner {b_idx+1} at {current_pos}")

            if step['type'] == 'roll':
                unit_got, next_p, note = tracker.get_next_pos_normal(current_pos, entry.get('unit'), banner, last_unit)
                
                if not unit_got or not next_p:
                    print(f"Step {i+1} FAILED. Could not simulate roll at {current_pos}. End of data?")
                    valid = False
                    break
                
                # Optional: Verify unit name
                match_unit = re.search(r'Got: (.*?)(?: \*\*|$)', step['raw'])
                if match_unit:
                    expected_unit = match_unit.group(1).strip()
                    if expected_unit != unit_got:
                         print(f"Step {i+1} WARNING: Expected '{expected_unit}', Got '{unit_got}' at {current_pos}")

                current_pos = next_p
                last_unit = unit_got

            elif step['type'] == '11-draw':
                guaranteed_unit = entry.get('guaranteed_unit')
                guaranteed_next = entry.get('guaranteed_next')
                
                if not guaranteed_unit or not guaranteed_next:
                    print(f"Step {i+1} FAILED. Not a guaranteed roll position at {current_pos}.")
                    valid = False
                    break

                # Simulate 10 draws
                temp_pos = current_pos
                temp_last = last_unit
                simulation_failed = False
                simulated_units = []
                
                for k in range(10):
                    u, np, _ = tracker.get_next_pos_normal(temp_pos, None, banner, temp_last)
                    if not u:
                        print(f"Step {i+1} FAILED. Error during internal roll {k+1} of 11-draw at {current_pos}.")
                        simulation_failed = True
                        break
                    simulated_units.append(u)
                    temp_pos = np
                    temp_last = u
                
                if simulation_failed:
                    valid = False
                    break
                
                simulated_units.append(guaranteed_unit)

                # Verify unit count from solution file
                if step.get('full_draw_raw'):
                    # Format: > Full Draw: Unit1, Unit2, ... + **GuaranteedUnit**
                    raw_text = step['full_draw_raw'].replace('> Full Draw:', '').strip()
                    
                    parts = raw_text.split(' + ')
                    if len(parts) != 2:
                         print(f"Step {i+1} WARNING: Malformed Full Draw line: '{raw_text}'")
                    else:
                        normal_part = parts[0]
                        guaranteed_part = parts[1].replace('**', '').strip()
                        
                        listed_units = [u.strip() for u in normal_part.split(',')]
                        listed_units.append(guaranteed_part)
                        
                        if len(listed_units) != 11:
                            print(f"Step {i+1} ERROR: Solution lists {len(listed_units)} units for 11-draw. Expected 11.")
                            valid = False
                
                current_pos = guaranteed_next
                last_unit = guaranteed_unit
        
        if valid:
            print(f"✅ {sol['name']} Verified! Final Position: {current_pos}")
        else:
            print(f"❌ {sol['name']} Failed verification.")

if __name__ == "__main__":
    verify_path()
